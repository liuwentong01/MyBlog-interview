/**
 * gateway.js - 网关控制平面
 *
 * 对应 OpenClaw 架构中的 Gateway Control Plane，是整个系统的大脑中枢。
 *
 * ===== 核心职责 =====
 *
 * Gateway 是所有消息的唯一入口。不管消息来自 CLI、Web、WhatsApp 还是 Telegram，
 * 都必须经过 Gateway 处理后才会到达 Agent。
 *
 * 类比：机场调度塔台，所有航班（消息）都经过中央塔台，由它分配到正确的跑道（Agent）。
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

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

class Gateway {
  /**
   * @param {object} config
   * @param {number} config.port - 监听端口（默认 18789，同 OpenClaw）
   * @param {string} config.host - 绑定地址（默认 127.0.0.1，只允许本地连接）
   * @param {Agent} config.agent - Agent 实例
   */
  constructor(config) {
    this.port = config.port || 18789;
    this.host = config.host || '127.0.0.1';
    this.agent = config.agent;

    /**
     * 已注册的渠道适配器：channelName -> ChannelAdapter
     * OpenClaw 支持 16+ 渠道，每个渠道通过 registerChannel 注册
     */
    this._channels = new Map();

    /**
     * 待处理消息映射：messageId -> { channelName, callbacks, idempotencyKey, ... }
     *
     * 这是事件驱动架构的核心数据结构。
     * 当消息被分发给 Agent 后，会在这里注册一个 pending entry。
     * Agent 处理完成后发射事件，Gateway 通过 messageId 查找 pending entry，
     * 然后调用对应的 callbacks 将结果路由回去。
     */
    this._pendingMessages = new Map();

    /**
     * 幂等键缓存：idempotencyKey -> response
     * OpenClaw 要求所有 side-effecting 操作携带幂等键，
     * 防止网络重试导致同一条消息被重复处理。
     */
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
  registerChannel(name, channel) {
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
  submitMessage(channelName, rawInput, callbacks) {
    const channel = this._channels.get(channelName);
    if (!channel) {
      callbacks.onError(new Error(`未注册的渠道: ${channelName}`));
      return;
    }

    // ====== 阶段 2 的一部分：消息解析 ======
    // Channel Adapter 将平台特定的原始消息转换为统一的内部格式
    const message = channel.parseIncoming(rawInput);

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
      const cached = this._idempotencyCache.get(message.idempotencyKey);
      console.log(`[Gateway] 幂等键命中，返回缓存结果: ${message.idempotencyKey}`);
      callbacks.onResponse(cached);
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
    this.agent.processMessage(message).catch(err => {
      // processMessage 内部已经 emit('agent:error')
      // 这里的 catch 是兜底，防止未处理的 Promise rejection
      console.error(`[Gateway] Agent 处理异常:`, err.message);
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
   *   - 未来可以轻松接入消息队列（Redis Streams 等）
   */
  _subscribeAgentEvents() {
    // 开始处理事件 → 向客户端发送"正在输入"提示
    this.agent.on('agent:processing', ({ messageId }) => {
      const pending = this._pendingMessages.get(messageId);
      if (pending?.callbacks.onEvent) {
        pending.callbacks.onEvent('processing', { messageId });
      }
    });

    // 工具调用事件 → 实时推送工具调用信息（可用于展示进度）
    this.agent.on('agent:tool_call', ({ messageId, toolName, arguments: args, round }) => {
      const pending = this._pendingMessages.get(messageId);
      if (pending?.callbacks.onEvent) {
        pending.callbacks.onEvent('tool_call', { toolName, arguments: args, round });
      }
    });

    // 最终回复事件 → 路由到对应的渠道连接
    this.agent.on('agent:response', ({ messageId, response }) => {
      const pending = this._pendingMessages.get(messageId);
      if (!pending) return;

      // 缓存结果（供幂等键去重使用）
      this._idempotencyCache.set(pending.idempotencyKey, response);

      // 调用 onResponse 回调，将结果发送回客户端
      pending.callbacks.onResponse(response);

      // 清理 pending entry
      this._pendingMessages.delete(messageId);
    });

    // 错误事件 → 将错误信息发送给客户端
    this.agent.on('agent:error', ({ messageId, error }) => {
      const pending = this._pendingMessages.get(messageId);
      if (!pending) return;

      pending.callbacks.onError(error);
      this._pendingMessages.delete(messageId);
    });
  }

  // ======================================================================
  // HTTP + WebSocket 服务器
  // ======================================================================

  start() {
    this._httpServer = http.createServer((req, res) => this._handleHTTP(req, res));

    this._wss = new WebSocketServer({ server: this._httpServer });
    this._wss.on('connection', (ws, req) => this._handleConnection(ws, req));

    this._httpServer.listen(this.port, this.host, () => {
      console.log(`\n🦞 Mini-OpenClaw Gateway 已启动`);
      console.log(`   HTTP:      http://${this.host}:${this.port}`);
      console.log(`   WebSocket: ws://${this.host}:${this.port}/ws`);
      console.log(`   Web UI:    http://${this.host}:${this.port}\n`);
    });

    this._cleanupInterval = setInterval(() => this._cleanCaches(), 60000);
  }

  stop() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    if (this._wss) this._wss.close();
    if (this._httpServer) this._httpServer.close();
    console.log('[Gateway] 已停止');
  }

  // ======================================================================
  // HTTP 路由
  // ======================================================================

  _handleHTTP(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/' || req.url === '/index.html') {
      this._serveWebUI(res);
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        connections: this._wss ? this._wss.clients.size : 0,
        channels: Array.from(this._channels.keys()),
      }));
    } else if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agent: { llm: this.agent.llmProvider.name },
        tools: this.agent.toolSystem.getToolNames(),
        sessions: this.agent.sessionManager.listSessions(),
        channels: Array.from(this._channels.keys()),
      }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  _serveWebUI(res) {
    const uiPath = path.join(__dirname, 'web-ui.html');
    try {
      const html = fs.readFileSync(uiPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Web UI 加载失败');
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
  _handleConnection(ws, req) {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const userId = `web_${connectionId}`;

    console.log(`[Gateway] 新 WebSocket 连接: ${connectionId}`);

    // 注册到 Web 渠道的连接池（用于后续消息发送）
    const webChannel = this._channels.get('web');
    if (webChannel) {
      webChannel.registerConnection(userId, ws);
    }

    // 发送连接成功事件
    this._send(ws, {
      type: 'event',
      event: 'connected',
      payload: { connectionId, userId },
    });

    // 阶段 3 & 4: Dispatch + Broadcast — 处理收到的消息
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        this._handleWSMessage(ws, userId, parsed);
      } catch (err) {
        // Wire Protocol 格式校验失败：立刻拒绝
        this._send(ws, {
          type: 'res',
          id: null,
          ok: false,
          error: `消息格式错误: ${err.message}`,
        });
      }
    });

    ws.on('error', (err) => {
      console.error(`[Gateway] WebSocket 错误 (${connectionId}):`, err.message);
    });
  }

  /**
   * 处理 WebSocket 消息（Wire Protocol 解析）
   */
  async _handleWSMessage(ws, userId, message) {
    if (!message.type) {
      this._send(ws, { type: 'res', id: message.id, ok: false, error: '缺少 type 字段' });
      return;
    }

    if (message.type === 'req') {
      await this._handleRequest(ws, userId, message);
    }
  }

  /**
   * 处理 req 类型消息
   *
   * Web 渠道的消息也通过 submitMessage 统一入口处理，
   * 确保经过与 CLI 相同的访问控制和幂等键检查流程。
   */
  _handleRequest(ws, userId, message) {
    const { id: requestId, method, params } = message;

    switch (method) {
      case 'send': {
        // Web 消息通过 submitMessage 统一入口 → 走完整流程
        this.submitMessage('web', {
          userId,
          text: params.text,
          idempotencyKey: params.idempotencyKey || `web_${Date.now()}`,
        }, {
          // 中间事件回调：通过 WebSocket 推送给浏览器
          onEvent: (type, payload) => {
            this._send(ws, { type: 'event', event: type, payload });
          },
          // 最终回复回调：通过 WebSocket 返回 Wire Protocol 响应
          onResponse: (response) => {
            this._send(ws, { type: 'res', id: requestId, ok: true, payload: response });
          },
          // 错误回调
          onError: (err) => {
            this._send(ws, { type: 'res', id: requestId, ok: false, error: err.message });
          },
        });
        break;
      }
      case 'status': {
        this._send(ws, {
          type: 'res',
          id: requestId,
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
          type: 'res',
          id: requestId,
          ok: false,
          error: `未知方法: ${method}`,
        });
      }
    }
  }

  /** 发送 WebSocket 消息 */
  _send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  /** 清理过期缓存 */
  _cleanCaches() {
    const now = Date.now();
    // 清理幂等键缓存
    for (const [key, value] of this._idempotencyCache) {
      if (now - (value.timestamp || 0) > this._idempotencyTTL) {
        this._idempotencyCache.delete(key);
      }
    }
    // 清理超时的 pending 消息（30 秒无响应视为超时）
    for (const [msgId, pending] of this._pendingMessages) {
      if (now - pending.timestamp > 30000) {
        pending.callbacks.onError(new Error('处理超时'));
        this._pendingMessages.delete(msgId);
      }
    }
  }
}

module.exports = Gateway;
