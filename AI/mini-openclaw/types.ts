/**
 * types.ts - 全局类型定义
 *
 * 集中管理 Mini-OpenClaw 各模块共享的 TypeScript 类型。
 * 对应 OpenClaw 源码中分散在各模块的 interface/type 定义。
 */

// ========== 消息相关 ==========

/** 统一消息格式（所有渠道解析后的内部格式） */
export interface IncomingMessage {
  id: string;
  channelType: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  peerKind: "main" | "dm" | "group";
  groupId: string | null;
  idempotencyKey: string;
}

/** Agent 的最终回复 */
export interface AgentResponse {
  id: string;
  messageId: string;
  sessionId: string;
  text: string;
  toolCalls: ToolCallRecord[] | null;
  timestamp: number;
  processingTime: number;
}

// ========== 工具系统 ==========

/** 工具调用记录（用于调试和展示） */
export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  round: number;
}

/** 工具定义（注册到 ToolSystem 的完整定义） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** OpenAI function calling 兼容的工具定义格式（发给 LLM） */
export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ========== LLM 相关 ==========

/** LLM 工具调用请求 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 聊天消息（对话历史中的一条） */
export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
}

/** LLM 请求 */
export interface LLMRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: LLMToolDefinition[];
}

/** LLM 响应 */
export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[] | null;
  finishReason: "stop" | "tool_calls";
}

/** LLM 提供商接口 */
export interface LLMProvider {
  name: string;
  chat(request: LLMRequest): Promise<LLMResponse>;
}

// ========== 会话相关 ==========

/** 会话元数据 */
export interface SessionMetadata {
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

/** 会话 */
export interface Session {
  id: string;
  history: ChatMessage[];
  metadata: SessionMetadata;
}

// ========== 记忆相关 ==========

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  content: string;
  sessionId: string;
  tags: string[];
  timestamp: number;
}

/** 保存记忆时的输入 */
export interface MemorySaveInput {
  content: string;
  sessionId?: string;
  tags?: string[];
}

// ========== Gateway 相关 ==========

/** Gateway.submitMessage 的回调集合 */
export interface SubmitCallbacks {
  onEvent: (type: string, payload: Record<string, unknown>) => void;
  onResponse: (response: AgentResponse) => void;
  onError: (error: Error) => void;
}

/** 插件导出格式 */
export interface PluginExport {
  name: string;
  description?: string;
  tools?: ToolDefinition[];
}
