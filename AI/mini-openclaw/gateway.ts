/**
 * gateway.js - 网关控制平面
 *
 * 对应 OpenClaw 架构中的 Gateway Control Plane，是整个系统的大脑中枢。
 *
 * ===== 整体流程图 =====
 *
 *  ┌─────────┐    ┌─────────────┐    ┌──────────────┐
 *  │   CLI   │    │ Web Browser │    │   Telegram   │
 *  └────┬────┘    └──────┬──────┘    └──────┬───────┘
 *       │                │ WebSocket 握手    │ Long Polling (getUpdates)
 *       │                ▼                   │
 *       │         ┌──────────────────────┐   │
 *       │         │  _handleConnection() │   │
 *       │         │  分配 connectionId   │   │
 *       │         │  注册到 WebChannel   │   │
 *       │         └──────────┬───────────┘   │
 *       │                    │ ws.on("message")
 *       │                    ▼               │
 *       │         ┌──────────────────────┐   │
 *       │         │  _handleWSMessage()  │   │
 *       │         │  JSON.parse + 校验   │   │
 *       │         └──────────┬───────────┘   │
 *       │                    │ type === "req" │
 *       │                    ▼               │
 *       │         ┌──────────────────────┐   │
 *       │         │  _handleRequest()    │   │
 *       │         │  method: send/status │   │
 *       │         └──────────┬───────────┘   │
 *       │                    │ 构造 callbacks │ index.ts 中构造 callbacks
 *       │                    │               │ (sendMessage API 回复)
 *       ▼                    ▼               ▼
 *  ┌──────────────────────────────────────────────┐
 *  │              submitMessage()                  │ ← 统一入口，所有渠道在此汇合
 *  │                                              │
 *  │  1. channel.parseIncoming()                  │ ← 阶段2a: 消息解析
 *  │  2. channel.checkAccess()                    │ ← 阶段2b: 访问控制
 *  │     ├─ 拒绝 → onError                       │
 *  │  3. _idempotencyCache.has()                  │ ← 阶段3a: 幂等键检查
 *  │     ├─ 命中 → 返回缓存结果                    │
 *  │  4. _pendingMessages.set()                   │ ← 阶段3b: 注册 pending
 *  │  5. agent.processMessage()                   │ ← 异步分发给 Agent
 *  └──────────────────────┬───────────────────────┘
 *                         │ 异步（fire-and-forget）
 *                         ▼
 *                  ┌─────────────┐
 *                  │    Agent    │
 *                  │  处理消息    │
 *                  └──────┬──────┘
 *                         │ emit 事件
 *                         ▼
 *  ┌──────────────────────────────────────────────┐
 *  │         _subscribeAgentEvents()               │ ← 阶段4: 事件路由
 *  │                                              │
 *  │  agent:processing → onEvent()                │   "正在处理"
 *  │  agent:tool_call  → onEvent()                │   工具调用进度
 *  │  agent:response   → onResponse()             │   最终回复 + 缓存结果
 *  │  agent:error      → onError()                │   错误信息
 *  │                                              │
 *  │  通过 messageId 查 _pendingMessages           │
 *  │  调用对应的 callbacks 路由回客户端              │
 *  └──────────────────────┬───────────────────────┘
 *                         │
 *       ┌─────────────────┼─────────────────┐
 *       ▼                 ▼                 ▼
 *  ┌─────────┐    ┌──────────────┐   ┌──────────────┐
 *  │  CLI    │    │ Web Browser  │   │   Telegram   │
 *  │ stdout  │    │ ws.send(JSON)│   │ sendMessage  │
 *  └─────────┘    └──────────────┘   └──────────────┘
 *
 * ===== 核心职责 =====
 *
 * Gateway 是所有消息的唯一入口。不管消息来自 CLI、Web、WhatsApp 还是 Telegram，
 * 都必须经过 Gateway 处理后才会到达 Agent。
 *
 * ===== 消息处理流程（对应 OpenClaw 的四阶段） =====
 *
 *   阶段 1: Connect（连接）
 *     → 客户端建立 WebSocket 连接，分配连接 ID
 *
 *   阶段 2: Authorize（授权）+ Access Control（访问控制）
 *     → 本地连接自动信任，远程连接需 JWT 验证
 *     → 检查白名单、配对审批、群聊 @提及策略
 *
 *   阶段 3: Dispatch（分发）
 *     → 幂等键去重 → 解析消息 → 分发给 Agent
 *
 *   阶段 4: Broadcast（广播）
 *     → 监听 Agent 事件，将结果路由到正确的渠道/连接
 *
 * ===== 事件驱动设计 =====
 *
 * Gateway 和 Agent 通过事件总线通信（pub/sub 模式），而非同步请求-响应。
 *
 * Gateway 监听 Agent 的事件：
 *   agent:processing → 向客户端发送"正在处理"提示
 *   agent:tool_call  → 向客户端实时推送工具调用信息
 *   agent:response   → 将最终回复路由到对应的渠道连接
 *   agent:error      → 将错误信息发送给客户端
 *
 * 每个事件携带 messageId，Gateway 通过 _pendingMessages 映射表
 * 将事件路由到发起该消息的具体渠道和连接。
 *
 * ===== Wire Protocol =====
 *
 * WebSocket 消息格式（JSON 文本帧）：
 *   请求: { type: 'req', id: string, method: string, params: object }
 *   响应: { type: 'res', id: string, ok: boolean, payload | error }
 *   事件: { type: 'event', event: string, payload: object }
 */

import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import Agent from "./agent";
import { BaseChannel, WebChannel } from "./channel-adapter";
import type { IncomingMessage, AgentResponse, SubmitCallbacks } from "./types";

/** 待处理消息条目 */
interface PendingMessage {
  channelName: string;
  idempotencyKey: string;
  callbacks: SubmitCallbacks;
  timestamp: number;
}

/** WebSocket 请求消息格式 */
interface WsRequestMessage {
  type?: string;
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
}

class Gateway {
  agent: Agent;
  port: number;
  host: string;
  private _httpServer: http.Server | null = null;
  private _wss: WebSocketServer | null = null;
  private _channels: Map<string, BaseChannel> = new Map();
  private _pendingMessages: Map<string, PendingMessage> = new Map();
  private _idempotencyCache: Map<string, { response: AgentResponse; expiry: number }> = new Map();
  private _idempotencyTTL: number;
  private _cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * @param {object} config
   * @param {number} config.port - 监听端口（默认 18789，同 OpenClaw）
   * @param {string} config.host - 绑定地址（默认 127.0.0.1，只允许本地连接）
   * @param {Agent} config.agent - Agent 实例
   */
  constructor(config: { agent: Agent; port?: number; host?: string }) {
    this.port = config.port ?? 18789;
    this.host = config.host ?? "127.0.0.1";
    this.agent = config.agent;

    /**
     * 已注册的渠道适配器：channelName -> ChannelAdapter
     * OpenClaw 支持 16+ 渠道，每个渠道通过 registerChannel 注册
     */
    // {
    //   "cli" => CLIChannel {
    //     name: "cli",
    //     allowlist: Set {},              // 空 = 不限制
    //     requireMention: false,
    //     _rl: ReadlineInterface { ... }, // stdin/stdout 交互句柄
    //   },
    //
    //   "web" => WebChannel {
    //     name: "web",
    //     allowlist: Set {},
    //     requireMention: false,
    //     _connections: Map {             // userId -> WebSocket 连接池
    //       "web_conn_1741405200000_a3f2" => WebSocket { readyState: 1, ... },
    //       "web_conn_1741405205000_b7c1" => WebSocket { readyState: 1, ... },
    //     },
    //   },
    //
    //   "telegram" => TelegramChannel {
    //     name: "telegram",
    //     allowlist: Set { "123456789", "987654321" },  // Telegram user ID 白名单
    //     requireMention: false,
    //     _botToken: "7012345678:AAF...",
    //     _pollingInterval: 1000,
    //     _offset: 582473921,             // getUpdates 的 offset，防止重复拉取
    //     _polling: true,
    //   },
    // }
    this._channels = new Map();

    /**
     * 待处理消息映射：messageId -> { channelName, callbacks, idempotencyKey, ... }
     *
     * 这是事件驱动架构的核心数据结构。
     * 当消息被分发给 Agent 后，会在这里注册一个 pending entry。
     * Agent 处理完成后发射事件，Gateway 通过 messageId 查找 pending entry，
     * 然后调用对应的 callbacks 将结果路由回去。
     */
    // {
    //   CLI 用户发的一条消息
    //   "msg_a1b2c3" => {
    //     channelName: "cli",
    //     idempotencyKey: "idem_cli_001",
    //     callbacks: {
    //       onEvent: (type, payload) => { /* 往 stdout 打印 "思考中..." */ },
    //       onResponse: (response) => { /* 把回复写到终端 */ },
    //       onError: (error) => { /* 终端打印错误 */ },
    //     },
    //     timestamp: 1741405200000,
    //   },

    //   Web 用户通过 WebSocket 发的一条消息
    //   "msg_x7y8z9" => {
    //     channelName: "web",
    //     idempotencyKey: "idem_web_042",
    //     callbacks: {
    //       onEvent: (type, payload) => { /* ws.send({ type: "event", ... }) */ },
    //       onResponse: (response) => { /* ws.send({ type: "response", ... }) */ },
    //       onError: (error) => { /* ws.send({ type: "error", ... }) */ },
    //     },
    //     timestamp: 1741405201500,
    //   },
    // }
    this._pendingMessages = new Map();

    /**
     * TODO: 幂等键缓存：idempotencyKey -> response
     * OpenClaw 要求所有 side-effecting 操作携带幂等键，
     * 防止网络重试导致同一条消息被重复处理。
     */
    // {
    //   CLI 用户发的一条消息的缓存结果
    //   "cli_1741405200000" => {
    //     response: {
    //       id: "resp_abc123",
    //       messageId: "msg_1741405200000",
    //       sessionId: "sess_cli_user",
    //       text: "北京今天晴，气温 22°C，适合户外活动。",
    //       toolCalls: [
    //         { name: "get_weather", arguments: { city: "北京" }, result: "晴 22°C", round: 1 },
    //       ],
    //       timestamp: 1741405203000,
    //       processingTime: 3000,
    //     },
    //     expiry: 1741405203000,          // 写入时间戳，超过 _idempotencyTTL(5min) 后被清理
    //   },
    //
    //   Web 用户发的一条消息的缓存结果
    //   "web_1741405201500" => {
    //     response: {
    //       id: "resp_xyz789",
    //       messageId: "msg_1741405201500",
    //       sessionId: "sess_web_conn_1741405200000_a3f2",
    //       text: "Hello! How can I help you?",
    //       toolCalls: null,
    //       timestamp: 1741405202800,
    //       processingTime: 1300,
    //     },
    //     expiry: 1741405202800,
    //   },
    //
    //   Telegram 消息的缓存结果（幂等键基于 message_id，天然去重）
    //   "tg_48291" => {
    //     response: {
    //       id: "resp_tg_001",
    //       messageId: "msg_tg_48291_1741405210000",
    //       sessionId: "sess_123456789",
    //       text: "已为你查询到航班信息...",
    //       toolCalls: [
    //         { name: "search_flights", arguments: { from: "PEK", to: "SHA" }, result: "CA1234 08:00...", round: 1 },
    //       ],
    //       timestamp: 1741405215000,
    //       processingTime: 5000,
    //     },
    //     expiry: 1741405215000,
    //   },
    // }
    this._idempotencyCache = new Map();
    this._idempotencyTTL = 5 * 60 * 1000;

    this._httpServer = null;
    this._wss = null;

    // 订阅 Agent 事件（事件驱动路由的核心）
    this._subscribeAgentEvents();
  }

  /**
   * 注册渠道适配器
   *
   * 所有渠道（CLI、Web、Telegram 等）都通过此方法注册到 Gateway。
   * 注册后，渠道的消息可以通过 submitMessage() 统一入口进入处理流程。
   */
  registerChannel(name: string, channel: BaseChannel): void {
    this._channels.set(name, channel);
    console.log(`[Gateway] 注册渠道: ${name}`);
  }

  /**
   * 统一消息入口（核心方法）
   *
   * 所有渠道的消息都通过此方法进入 Gateway 的处理流程。
   * 这确保了 CLI、Web、WhatsApp 等渠道的消息都经过相同的：
   *   消息解析 → 访问控制 → 幂等键检查 → Agent 分发
   *
   * @param {string} channelName - 渠道名称（如 'cli', 'web'）
   * @param {any} rawInput - 渠道的原始输入（Channel Adapter 负责解析）
   * @param {object} callbacks - 事件回调（事件驱动的核心）
   * @param {function} callbacks.onEvent - 中间事件回调 (type, payload) => void
   * @param {function} callbacks.onResponse - 最终回复回调 (response) => void
   * @param {function} callbacks.onError - 错误回调 (error) => void
   */
  submitMessage(channelName: string, rawInput: string | Record<string, unknown>, callbacks: SubmitCallbacks): void {
    const channel = this._channels.get(channelName);
    if (!channel) {
      callbacks.onError(new Error(`未注册的渠道: ${channelName}`));
      return;
    }

    // ====== 阶段 2 的一部分：消息解析 ======
    // Channel Adapter 将平台特定的原始消息转换为统一的内部格式
    const message = channel.parseIncoming(rawInput as string);

    // ====== 阶段 2：访问控制 (Access Control) ======
    // OpenClaw 的访问控制是消息生命周期的关键环节：
    //   - 白名单检查：发送者是否在允许列表中
    //   - 配对审批：首次私聊是否通过审批
    //   - 群聊策略：是否需要 @提及才回复
    //
    // 未通过访问控制的消息到此为止，不会到达 Agent
    if (!channel.checkAccess(message.senderId)) {
      console.log(`[Gateway] 访问控制拒绝: ${message.senderId} (渠道: ${channelName})`);
      callbacks.onError(new Error(`访问被拒绝: 用户 ${message.senderId} 不在白名单中`));
      return;
    }

    // ====== 阶段 3：幂等键检查 ======
    // 防止网络重试导致同一条消息被重复处理
    if (this._idempotencyCache.has(message.idempotencyKey)) {
      const cached = this._idempotencyCache.get(message.idempotencyKey)!;
      console.log(`[Gateway] 幂等键命中，返回缓存结果: ${message.idempotencyKey}`);
      callbacks.onResponse(cached.response);
      return;
    }

    // ====== 阶段 3：注册 pending + 分发给 Agent ======
    // 在 _pendingMessages 中注册，Agent 事件回来时通过 messageId 路由
    this._pendingMessages.set(message.id, {
      channelName,
      idempotencyKey: message.idempotencyKey,
      callbacks,
      timestamp: Date.now(),
    });

    // 异步分发给 Agent（fire-and-forget 风格）
    // 结果通过 Agent 事件回来，而非 await 返回值
    // 这就是事件驱动和同步调用的核心区别
    this.agent.processMessage(message).catch((err) => {
      // processMessage 内部已经 emit('agent:error')
      // 这里的 catch 是兜底，防止未处理的 Promise rejection
      console.error(`[Gateway] Agent 处理异常:`, (err as Error).message);
    });
  }

  /**
   * 订阅 Agent 事件（事件驱动路由的核心）
   *
   * Agent 在处理消息过程中发射事件，Gateway 监听这些事件
   * 并通过 messageId 将它们路由到发起消息的具体渠道和连接。
   *
   * 这种 pub/sub 模式使得 Gateway 和 Agent 松耦合：
   *   - Gateway 不需要等待 Agent 完成（非阻塞）
   *   - Agent 不需要知道消息来自哪个渠道（只管发射事件）
   *   - 未来可以轻松接入消息队列（Redis Streams 等）（现在只是本地使用使用eventemitter进行通信，后面可以接入Redis Streams，以防止node进程重启导致事件丢失）
   */
  private _subscribeAgentEvents(): void {
    // 开始处理事件 → 向客户端发送"正在输入"提示
    this.agent.on("agent:processing", ({ messageId }: { messageId: string }) => {
      const pending = this._pendingMessages.get(messageId);
      if (pending?.callbacks.onEvent) {
        pending.callbacks.onEvent("processing", { messageId });
      }
    });

    // 工具调用事件 → 实时推送工具调用信息（可用于展示进度）
    this.agent.on(
      "agent:tool_call",
      ({
        messageId,
        toolName,
        arguments: args,
        round,
      }: {
        messageId: string;
        toolName: string;
        arguments: Record<string, unknown>;
        round: number;
      }) => {
        const pending = this._pendingMessages.get(messageId);
        if (pending?.callbacks.onEvent) {
          pending.callbacks.onEvent("tool_call", { toolName, arguments: args, round });
        }
      },
    );

    // 最终回复事件 → 路由到对应的渠道连接
    this.agent.on("agent:response", ({ messageId, response }: { messageId: string; response: AgentResponse }) => {
      const pending = this._pendingMessages.get(messageId);
      if (!pending) return;

      // 缓存结果（供幂等键去重使用）
      this._idempotencyCache.set(pending.idempotencyKey, {
        response,
        expiry: Date.now(),
      });

      // 调用 onResponse 回调，将结果发送回客户端
      pending.callbacks.onResponse(response);

      // 清理 pending entry
      this._pendingMessages.delete(messageId);
    });

    // 错误事件 → 将错误信息发送给客户端
    this.agent.on("agent:error", ({ messageId, error }: { messageId: string; error: Error }) => {
      const pending = this._pendingMessages.get(messageId);
      if (!pending) return;

      pending.callbacks.onError(error);
      this._pendingMessages.delete(messageId);
    });
  }

  // ======================================================================
  // HTTP + WebSocket 服务器
  // ======================================================================

  start(): void {
    this._httpServer = http.createServer((req, res) => this._handleHTTP(req, res));

    this._wss = new WebSocketServer({ server: this._httpServer });
    this._wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => this._handleConnection(ws, req));

    this._httpServer.listen(this.port, this.host, () => {
      console.log(`\n🦞 Mini-OpenClaw Gateway 已启动`);
      console.log(`   HTTP:      http://${this.host}:${this.port}`);
      console.log(`   WebSocket: ws://${this.host}:${this.port}/ws`);
      console.log(`   Web UI:    http://${this.host}:${this.port}\n`);
    });

    this._cleanupInterval = setInterval(() => this._cleanCaches(), 60000);
  }

  stop(): void {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    if (this._wss) this._wss.close();
    if (this._httpServer) this._httpServer.close();
    console.log("[Gateway] 已停止");
  }

  // ======================================================================
  // HTTP 路由
  // ======================================================================

  private _handleHTTP(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/" || req.url === "/index.html") {
      this._serveWebUI(res);
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          uptime: process.uptime(),
          connections: this._wss ? this._wss.clients.size : 0,
          channels: Array.from(this._channels.keys()),
        }),
      );
    } else if (req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      const agent = this.agent as unknown as {
        llmProvider: { name: string };
        toolSystem: { getToolNames: () => string[] };
        sessionManager: { listSessions: () => unknown[] };
      };
      res.end(
        JSON.stringify({
          agent: { llm: agent.llmProvider.name },
          tools: agent.toolSystem.getToolNames(),
          sessions: agent.sessionManager.listSessions(),
          channels: Array.from(this._channels.keys()),
        }),
      );
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  private _serveWebUI(res: http.ServerResponse): void {
    const uiPath = path.join(__dirname, "web-ui.html");
    try {
      const html = fs.readFileSync(uiPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end("Web UI 加载失败");
    }
  }

  // ======================================================================
  // WebSocket 连接处理
  // 对应 OpenClaw 的四阶段连接流程
  // ======================================================================

  /**
   * 处理新的 WebSocket 连接
   *
   * 阶段 1: Connect — 握手 + 分配连接 ID
   * 阶段 2: Authorize — 简化版自动信任本地连接
   *         （OpenClaw 中远程连接需要 JWT 验证）
   */
  private _handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userId = `web_${connectionId}`;

    console.log(`[Gateway] 新 WebSocket 连接: ${connectionId}`);

    // 注册到 Web 渠道的连接池（用于后续消息发送）
    const webChannel = this._channels.get("web");
    if (webChannel && webChannel instanceof WebChannel) {
      webChannel.registerConnection(userId, ws);
    }

    // 发送连接成功事件
    this._sendWs(ws, {
      type: "event",
      event: "connected",
      payload: { connectionId, userId },
    });

    // 阶段 3 & 4: Dispatch + Broadcast — 处理收到的消息
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const str = Buffer.isBuffer(data)
          ? data.toString()
          : Array.isArray(data)
            ? Buffer.concat(data).toString()
            : Buffer.from(data as ArrayBuffer).toString();
        const parsed = JSON.parse(str) as WsRequestMessage;
        this._handleWSMessage(ws, userId, parsed);
      } catch (err) {
        // Wire Protocol 格式校验失败：立刻拒绝
        this._sendWs(ws, {
          type: "res",
          id: null,
          ok: false,
          error: `消息格式错误: ${(err as Error).message}`,
        });
      }
    });

    ws.on("error", (err: Error) => {
      console.error(`[Gateway] WebSocket 错误 (${connectionId}):`, err.message);
    });
  }

  /**
   * 处理 WebSocket 消息（Wire Protocol 解析）
   */
  private async _handleWSMessage(ws: WebSocket, userId: string, message: WsRequestMessage): Promise<void> {
    if (!message.type) {
      this._sendWs(ws, { type: "res", id: message.id, ok: false, error: "缺少 type 字段" });
      return;
    }

    if (message.type === "req") {
      await this._handleRequest(ws, userId, message);
    }
  }

  /**
   * 处理 req 类型消息
   *
   * Web 渠道的消息也通过 submitMessage 统一入口处理，
   * 确保经过与 CLI 相同的访问控制和幂等键检查流程。
   */
  private _handleRequest(ws: WebSocket, userId: string, message: WsRequestMessage): void {
    const { id: requestId, method, params } = message;

    switch (method) {
      case "send": {
        // Web 消息通过 submitMessage 统一入口 → 走完整流程
        this.submitMessage(
          "web",
          {
            userId,
            text: (params?.text as string) ?? "",
            idempotencyKey: (params?.idempotencyKey as string) ?? `web_${Date.now()}`,
          },
          {
            // 中间事件回调：通过 WebSocket 推送给浏览器
            onEvent: (type, payload) => {
              this._sendWs(ws, { type: "event", event: type, payload });
            },
            // 最终回复回调：通过 WebSocket 返回 Wire Protocol 响应
            onResponse: (response) => {
              this._sendWs(ws, { type: "res", id: requestId, ok: true, payload: response });
            },
            // 错误回调
            onError: (err) => {
              this._sendWs(ws, { type: "res", id: requestId, ok: false, error: err.message });
            },
          },
        );
        break;
      }
      case "status": {
        const agent = this.agent as unknown as {
          toolSystem: { getToolNames: () => string[] };
          sessionManager: { listSessions: () => unknown[] };
        };
        this._sendWs(ws, {
          type: "res",
          id: requestId,
          ok: true,
          payload: {
            tools: agent.toolSystem.getToolNames(),
            sessions: agent.sessionManager.listSessions(),
          },
        });
        break;
      }
      default: {
        this._sendWs(ws, {
          type: "res",
          id: requestId,
          ok: false,
          error: `未知方法: ${method}`,
        });
      }
    }
  }

  /** 发送 WebSocket 消息 */
  private _sendWs(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  /** 清理过期缓存 */
  private _cleanCaches(): void {
    const now = Date.now();
    // 清理幂等键缓存
    for (const [key, value] of this._idempotencyCache) {
      if (now - value.expiry > this._idempotencyTTL) {
        this._idempotencyCache.delete(key);
      }
    }
    // 清理超时的 pending 消息（30 秒无响应视为超时）
    for (const [msgId, pending] of this._pendingMessages) {
      if (now - pending.timestamp > 30000) {
        pending.callbacks.onError(new Error("处理超时"));
        this._pendingMessages.delete(msgId);
      }
    }
  }
}

export default Gateway;
