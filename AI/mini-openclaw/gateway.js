/**
 * gateway.js - 网关控制平面
 *
 * 对应 OpenClaw 架构中的 Gateway Control Plane，是整个系统的大脑中枢。
 *
 * 所有消息和指令都经过 Gateway，它就像一个快递分拣中心：
 * 1. 所有包裹（消息）进来后，检查格式和安全性
 * 2. 分配到正确的分拣线（Agent）
 * 3. 把回复发出去
 *
 * OpenClaw Gateway 的核心设计：
 * - HTTP 服务器：提供 Web UI 和健康检查接口
 * - WebSocket 服务器：实时双向通信
 * - Wire Protocol：{ type: 'req'|'res'|'event', ... } 格式的 JSON 消息
 * - 幂等键 (Idempotency Key)：防止重复处理同一条消息
 * - 事件驱动：pub/sub 模型，客户端订阅事件而非轮询
 * - 默认绑定 127.0.0.1（只允许本地连接）
 *
 * 连接四阶段流程：Connect（握手）→ Authorize（授权）→ Dispatch（分发）→ Broadcast（广播）
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

class Gateway {
  /**
   * @param {object} config
   * @param {number} config.port - 监听端口（默认 18789，同 OpenClaw）
   * @param {string} config.host - 绑定地址（默认 127.0.0.1）
   * @param {Agent} config.agent - Agent 实例
   * @param {WebChannel} config.webChannel - Web 渠道实例
   */
  constructor(config) {
    this.port = config.port || 18789;
    this.host = config.host || "127.0.0.1";
    this.agent = config.agent;
    this.webChannel = config.webChannel;

    // 幂等键缓存：防止重复处理同一条消息
    // OpenClaw 要求所有 side-effecting 操作携带幂等键
    this._idempotencyCache = new Map();
    // 缓存过期时间（5 分钟）
    this._idempotencyTTL = 5 * 60 * 1000;

    // HTTP 服务器（提供 Web UI + API）
    this._httpServer = null;
    // WebSocket 服务器
    this._wss = null;
  }

  /**
   * 启动 Gateway
   *
   * OpenClaw 的 Gateway 基于 Node.js 22+，同时提供：
   * - HTTP 端点：Web UI、健康检查、Webhook 接收
   * - WebSocket 端点：实时消息通信
   */
  start() {
    // 创建 HTTP 服务器
    this._httpServer = http.createServer((req, res) => this._handleHTTP(req, res));

    // 创建 WebSocket 服务器，挂载在 HTTP 服务器上
    this._wss = new WebSocketServer({ server: this._httpServer });
    this._wss.on("connection", (ws, req) => this._handleConnection(ws, req));

    // 启动监听
    this._httpServer.listen(this.port, this.host, () => {
      console.log(`\n🦞 Mini-OpenClaw Gateway 已启动`);
      console.log(`   HTTP:      http://${this.host}:${this.port}`);
      console.log(`   WebSocket: ws://${this.host}:${this.port}/ws`);
      console.log(`   Web UI:    http://${this.host}:${this.port}\n`);
    });

    // 定期清理过期的幂等键
    this._cleanupInterval = setInterval(() => this._cleanIdempotencyCache(), 60000);
  }

  stop() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    if (this._wss) this._wss.close();
    if (this._httpServer) this._httpServer.close();
    console.log("[Gateway] 已停止");
  }

  // ======================================================================
  // HTTP 请求处理
  // ======================================================================
  _handleHTTP(req, res) {
    // 设置 CORS 头（开发环境）
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 路由
    if (req.url === "/" || req.url === "/index.html") {
      this._serveWebUI(res);
    } else if (req.url === "/health") {
      // 健康检查端点
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          uptime: process.uptime(),
          connections: this._wss ? this._wss.clients.size : 0,
        }),
      );
    } else if (req.url === "/api/status") {
      // 系统状态 API
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          agent: { llm: this.agent.llmProvider.name },
          tools: this.agent.toolSystem.getToolNames(),
          sessions: this.agent.sessionManager.listSessions(),
        }),
      );
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  /** 提供 Web UI 页面 */
  _serveWebUI(res) {
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
  // 对应 OpenClaw 的四阶段连接流程：Connect → Authorize → Dispatch → Broadcast
  // ======================================================================

  /**
   * 处理新的 WebSocket 连接
   *
   * OpenClaw 的 Wire Protocol 消息格式：
   *   请求: { type: 'req', id: string, method: string, params: object }
   *   响应: { type: 'res', id: string, ok: boolean, payload/error }
   *   事件: { type: 'event', event: string, payload: object }
   */
  _handleConnection(ws, req) {
    // 阶段 1: Connect - 为连接分配 ID
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userId = `web_${connectionId}`;

    console.log(`[Gateway] 新 WebSocket 连接: ${connectionId}`);

    // 阶段 2: Authorize - 简化版直接信任本地连接
    // OpenClaw 中本地连接可自动信任，远程连接需要 JWT 验证

    // 注册到 Web 渠道
    this.webChannel.registerConnection(userId, ws);

    // 发送连接成功事件
    this._send(ws, {
      type: "event",
      event: "connected",
      payload: { connectionId, userId },
    });

    // 阶段 3: Dispatch - 处理收到的消息
    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        this._handleWSMessage(ws, userId, parsed);
      } catch (err) {
        // 格式校验失败：OpenClaw 会立刻拒绝格式不对的消息
        this._send(ws, {
          type: "res",
          id: null,
          ok: false,
          error: `消息格式错误: ${err.message}`,
        });
      }
    });

    ws.on("error", (err) => {
      console.error(`[Gateway] WebSocket 错误 (${connectionId}):`, err.message);
    });
  }

  /**
   * 处理 WebSocket 消息（Dispatch 阶段）
   *
   * 根据 Wire Protocol，处理不同类型的请求
   */
  async _handleWSMessage(ws, userId, message) {
    // 格式校验：必须有 type 字段
    if (!message.type) {
      this._send(ws, { type: "res", id: message.id, ok: false, error: "缺少 type 字段" });
      return;
    }

    if (message.type === "req") {
      await this._handleRequest(ws, userId, message);
    }
  }

  /**
   * 处理请求类型的消息
   */
  async _handleRequest(ws, userId, message) {
    const { id, method, params } = message;

    switch (method) {
      case "send": {
        // 发送消息给 Agent
        await this._dispatchToAgent(ws, userId, id, params);
        break;
      }
      case "status": {
        // 查询状态
        this._send(ws, {
          type: "res",
          id,
          ok: true,
          payload: {
            tools: this.agent.toolSystem.getToolNames(),
            sessions: this.agent.sessionManager.listSessions(),
          },
        });
        break;
      }
      default: {
        this._send(ws, {
          type: "res",
          id,
          ok: false,
          error: `未知方法: ${method}`,
        });
      }
    }
  }

  /**
   * 将消息分发给 Agent 处理
   *
   * 这里实现了幂等键去重机制：
   * OpenClaw 要求所有 side-effecting 操作携带 idempotencyKey，
   * 防止网络重试导致同一条消息被重复处理
   */
  async _dispatchToAgent(ws, userId, requestId, params) {
    const idempotencyKey = params.idempotencyKey || `${userId}_${Date.now()}`;

    // 幂等键检查：如果已经处理过，直接返回缓存的结果
    if (this._idempotencyCache.has(idempotencyKey)) {
      const cached = this._idempotencyCache.get(idempotencyKey);
      console.log(`[Gateway] 幂等键命中，返回缓存结果: ${idempotencyKey}`);
      this._send(ws, { type: "res", id: requestId, ok: true, payload: cached });
      return;
    }

    // 解析消息
    const incomingMessage = this.webChannel.parseIncoming({
      userId,
      text: params.text,
      idempotencyKey,
    });

    // 发送"处理中"事件（对应 OpenClaw 的"正在输入"提示）
    this._send(ws, {
      type: "event",
      event: "processing",
      payload: { messageId: incomingMessage.id },
    });

    try {
      // 调用 Agent 处理消息
      const response = await this.agent.processMessage(incomingMessage);

      // 缓存结果（供幂等键去重使用）
      this._idempotencyCache.set(idempotencyKey, response);

      // 阶段 4: Broadcast - 发送响应
      this._send(ws, { type: "res", id: requestId, ok: true, payload: response });

      // 广播给同一会话的其他连接
      this.webChannel.sendToUser(userId, response);
    } catch (err) {
      this._send(ws, {
        type: "res",
        id: requestId,
        ok: false,
        error: err.message,
      });
    }
  }

  /** 发送 WebSocket 消息 */
  _send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  /** 清理过期的幂等键缓存 */
  _cleanIdempotencyCache() {
    const now = Date.now();
    for (const [key, value] of this._idempotencyCache) {
      if (now - (value.timestamp || 0) > this._idempotencyTTL) {
        this._idempotencyCache.delete(key);
      }
    }
  }
}

module.exports = Gateway;
