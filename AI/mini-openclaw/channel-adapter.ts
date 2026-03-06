/**
 * channel-adapter.ts - 渠道适配器
 *
 * 对应 OpenClaw 架构中的 Channel Adapter，负责：
 * 1. 连接不同的聊天平台（WhatsApp、Telegram、Discord、CLI、Web 等）
 * 2. 统一消息格式（不同平台的 API 和协议千差万别）
 * 3. 访问控制（白名单、配对审批、群聊策略）
 * 4. 消息格式化输出（Markdown 转换、长消息切分）
 *
 * OpenClaw 支持 16+ 个渠道，每个渠道实现 ChannelPlugin 接口。
 * 每个适配器做四件事：收消息解析、身份验证、访问控制、发消息格式化。
 *
 * 简化版实现两个渠道：CLI（命令行）和 Web（浏览器）
 */

import readline from 'readline';
import { EventEmitter } from 'events';
import type { IncomingMessage, AgentResponse } from './types';
import type { WebSocket } from 'ws';

// ========================================================================
// BaseChannel - 渠道适配器基类
// 所有渠道都继承这个基类，实现统一的消息收发接口
// ========================================================================
class BaseChannel extends EventEmitter {
  name: string;
  allowlist: Set<string>;
  requireMention: boolean;

  constructor(name: string) {
    super();
    this.name = name;
    // 访问控制白名单
    this.allowlist = new Set();
    // 是否需要 @提及才回复（群聊场景）
    this.requireMention = false;
  }

  /**
   * 将渠道原始消息转换为统一的内部格式
   * 这是适配器模式的核心：屏蔽平台差异
   *
   * @param {any} rawMessage - 平台原始消息
   * @returns {object} 统一格式的消息
   */
  parseIncoming(rawInput: string): IncomingMessage {
    throw new Error('子类必须实现 parseIncoming 方法');
  }

  /**
   * 将 Agent 回复格式化为平台特定格式并发送
   * 处理 Markdown 转换、长消息切分、媒体上传等
   *
   * 支持两种调用方式（兼容现有调用方）：
   * - formatOutgoing(response) 传入完整 AgentResponse
   * - formatOutgoing(text, metadata) 传入文本和元数据
   */
  formatOutgoing(textOrResponse: string | AgentResponse, metadata?: Record<string, unknown>): string {
    throw new Error('子类必须实现 formatOutgoing 方法');
  }

  /**
   * 访问控制检查
   *
   * OpenClaw 的访问控制包含：
   * - 白名单检查（allowlist）
   * - DM 配对审批（pairing）
   * - 群聊 @提及检查
   *
   * @returns {boolean} 是否允许处理该消息
   */
  checkAccess(senderId: string): boolean {
    if (this.allowlist.size === 0) return true;
    return this.allowlist.has(senderId);
  }

  /** 启动渠道 */
  start(): void {
    throw new Error('子类必须实现 start 方法');
  }

  /** 停止渠道 */
  stop(): void {
    throw new Error('子类必须实现 stop 方法');
  }
}

// ========================================================================
// CLIChannel - 命令行渠道
// 最简单的渠道实现，通过 stdin/stdout 交互
// ========================================================================
interface CLIChannelConfig {
  userName?: string;
  userId?: string;
  allowedUsers?: string[];
}

class CLIChannel extends BaseChannel {
  _rl: readline.Interface | null = null;

  constructor(config: CLIChannelConfig = {}) {
    super('cli');
    if (config.allowedUsers) {
      config.allowedUsers.forEach((u) => this.allowlist.add(u));
    }
  }

  start(): void {
    this._rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n🤖 Mini-OpenClaw CLI 模式已启动');
    console.log('   输入消息与 AI 对话，输入 /quit 退出\n');
    this._prompt();
  }

  stop(): void {
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }
  }

  parseIncoming(text: string): IncomingMessage {
    return {
      id: `msg_${Date.now()}`,
      channelType: 'cli',
      senderId: 'cli_user',
      senderName: 'CLI 用户',
      text: text.trim(),
      timestamp: Date.now(),
      // CLI 用户视为 main 会话（最高权限，对应用户自己的操作）
      peerKind: 'main',
      groupId: null,
      idempotencyKey: `cli_${Date.now()}`,
    };
  }

  formatOutgoing(textOrResponse: string | AgentResponse, metadata?: Record<string, unknown>): string {
    const response = typeof textOrResponse === 'object' ? textOrResponse : (metadata as AgentResponse | undefined);
    const text = typeof textOrResponse === 'string' ? textOrResponse : textOrResponse.text;
    console.log(`\n🤖 AI: ${text}`);

    // 如果有工具调用，展示调用详情
    if (response?.toolCalls && response.toolCalls.length > 0) {
      console.log('\n📋 工具调用记录:');
      for (const tc of response.toolCalls) {
        console.log(`   🔧 ${tc.name}(${JSON.stringify(tc.arguments)}) → ${tc.result.slice(0, 80)}...`);
      }
    }

    const processingTime = response?.processingTime ?? 0;
    console.log(`   ⏱  处理耗时: ${processingTime}ms\n`);
    return '';
  }

  _prompt(): void {
    if (!this._rl) return;
    this._rl.question('👤 你: ', (input) => {
      if (!input || !input.trim()) {
        this._prompt();
        return;
      }

      if (input.trim() === '/quit') {
        console.log('👋 再见！');
        this.stop();
        process.exit(0);
        return;
      }

      // 发射原始文本，由 Gateway.submitMessage() 统一处理
      // Gateway 会调用 channel.parseIncoming() 解析 + channel.checkAccess() 检查权限
      // 这确保 CLI 和 Web 走完全相同的处理流程
      this.emit('message', input.trim());
    });
  }

  /** 消息处理完成后重新显示输入提示 */
  onResponseSent(): void {
    this._prompt();
  }
}

// ========================================================================
// WebChannel - Web 浏览器渠道
// 通过 WebSocket 与浏览器端的聊天 UI 通信
// 消息在 Gateway 中被路由到这里
// ========================================================================
interface WebChannelConfig {
  allowedUsers?: string[];
}

class WebChannel extends BaseChannel {
  _connections: Map<string, WebSocket> = new Map();

  constructor(config: WebChannelConfig = {}) {
    super('web');
    if (config.allowedUsers) {
      config.allowedUsers.forEach((u) => this.allowlist.add(u));
    }
    // WebSocket 连接池：userId -> ws
  }

  start(): void {
    console.log('[WebChannel] Web 渠道已就绪，等待 WebSocket 连接');
  }

  stop(): void {
    for (const ws of this._connections.values()) {
      ws.close();
    }
    this._connections.clear();
  }

  /**
   * 注册一个 WebSocket 连接
   * 当浏览器通过 WebSocket 连接到 Gateway 时，Gateway 会调用此方法
   */
  registerConnection(userId: string, ws: WebSocket): void {
    this._connections.set(userId, ws);
    console.log(`[WebChannel] 用户 ${userId} 已连接`);

    ws.on('close', () => {
      this._connections.delete(userId);
      console.log(`[WebChannel] 用户 ${userId} 已断开`);
    });
  }

  parseIncoming(rawInput: string | Record<string, unknown>): IncomingMessage {
    // rawInput 为 WebSocket 原始字符串时 JSON.parse；Gateway 也可能传入已解析对象
    const rawMessage = (typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput) as {
      userId?: string;
      userName?: string;
      text: string;
      peerKind?: 'main' | 'dm' | 'group';
      idempotencyKey?: string;
    };
    return {
      id: `msg_${Date.now()}`,
      channelType: 'web',
      senderId: rawMessage.userId || 'web_anonymous',
      senderName: rawMessage.userName || 'Web 用户',
      text: rawMessage.text,
      timestamp: Date.now(),
      // Web 用户默认为 dm（私聊）会话
      peerKind: rawMessage.peerKind || 'dm',
      groupId: null,
      idempotencyKey: rawMessage.idempotencyKey || `web_${Date.now()}`,
    };
  }

  formatOutgoing(textOrResponse: string | AgentResponse, metadata?: Record<string, unknown>): string {
    const response = typeof textOrResponse === 'object' ? textOrResponse : (metadata as AgentResponse | undefined);
    const text = typeof textOrResponse === 'string' ? textOrResponse : textOrResponse.text;
    // Web 渠道的消息格式化：生成 JSON 推送给浏览器
    const formatted = {
      type: 'response',
      id: response?.id,
      text,
      toolCalls: response?.toolCalls,
      processingTime: response?.processingTime,
      timestamp: response?.timestamp,
    };
    return JSON.stringify(formatted);
  }

  /** 向特定用户发送消息 */
  sendToUser(userId: string, response: AgentResponse): void {
    const ws = this._connections.get(userId);
    if (ws && ws.readyState === 1) {
      const formatted = this.formatOutgoing(response.text, { ...response });
      ws.send(formatted);
    }
  }

  /** 广播消息给所有连接的用户 */
  broadcast(response: AgentResponse): void {
    const formatted = this.formatOutgoing(response.text, { ...response });
    const data = formatted;
    for (const ws of this._connections.values()) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }
}

export { BaseChannel, CLIChannel, WebChannel };
