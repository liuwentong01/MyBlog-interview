/**
 * agent.js - Agent 运行时（核心引擎）
 *
 * 对应 OpenClaw 架构中的 Agent Runtime，是整个系统最核心的部分。
 *
 * Agent 是真正执行 AI 对话和工具调用的地方，相当于 AI 的"工作台"。
 * 每轮对话严格执行四个步骤：
 *
 *   步骤 1：会话解析 (Session Resolution)
 *           → 根据消息来源确定属于哪个会话，会话也是安全边界
 *
 *   步骤 2：上下文组装 (Context Assembly)
 *           → 加载会话历史 + 搜索相关记忆 + 拼装系统提示词
 *
 *   步骤 3：执行循环 (Execution Loop)
 *           → 调用 LLM → 如果有工具调用 → 执行工具 → 将结果回传给 LLM → 循环
 *
 *   步骤 4：保存状态 (Save State)
 *           → 将对话记录和工具调用结果存入会话历史 + 提取记忆
 *
 * ===== 事件驱动设计 =====
 *
 * 真实 OpenClaw 中 Agent 和 Gateway 通过事件总线通信，而非同步调用。
 * Agent 在处理过程中发射以下事件，Gateway 监听并路由到对应的渠道/连接：
 *
 *   agent:processing  → 开始处理消息
 *   agent:tool_call   → 正在调用工具（实时通知前端）
 *   agent:response    → 最终回复已生成
 *   agent:error       → 处理出错
 *
 * 每个事件都携带 messageId，Gateway 据此将事件路由到正确的连接。
 * 这种设计使得 Gateway 和 Agent 松耦合：Gateway 只负责路由，不关心 AI 怎么思考。
 */

const EventEmitter = require('events');

class Agent extends EventEmitter {
  /**
   * @param {object} deps - 依赖注入（OpenClaw 中 Agent 通过依赖注入组装各模块）
   * @param {SessionManager} deps.sessionManager - 会话管理器
   * @param {MemorySystem} deps.memory - 记忆系统
   * @param {PromptBuilder} deps.promptBuilder - 提示词组装器
   * @param {ToolSystem} deps.toolSystem - 工具系统
   * @param {LLMProvider} deps.llmProvider - LLM 提供商
   */
  constructor({ sessionManager, memory, promptBuilder, toolSystem, llmProvider }) {
    super();
    this.sessionManager = sessionManager;
    this.memory = memory;
    this.promptBuilder = promptBuilder;
    this.toolSystem = toolSystem;
    this.llmProvider = llmProvider;

    // 工具调用最大循环次数，防止无限循环
    // OpenClaw 中也有类似的安全阀机制
    this.maxToolRounds = 5;
  }

  /**
   * 处理一条消息的完整生命周期
   *
   * 对应 OpenClaw 文档中"一条消息从接收到回复的 6 个阶段"中的后 4 个阶段
   * （前 2 个阶段——消息接收和访问控制——由 Gateway 完成）
   *
   * 关键设计：该方法不直接返回结果，而是通过 EventEmitter 发射事件。
   * Gateway 监听这些事件并路由到正确的渠道连接。
   * 返回的 Promise 仅用于错误传播和调试，主要通信靠事件。
   *
   * @param {object} message - 经过 Gateway 访问控制后的消息
   *   { id, channelType, senderId, senderName, text, timestamp, peerKind, groupId }
   * @returns {Promise<object>} 回复消息（同时也会通过 agent:response 事件发射）
   */
  async processMessage(message) {
    const messageId = message.id;
    const startTime = Date.now();

    try {
      // 发射"开始处理"事件 → Gateway 可据此向前端发送"正在输入"提示
      this.emit('agent:processing', { messageId });

      // ======== 步骤 1: 会话解析 (Session Resolution) ========
      // 根据消息的来源（渠道类型、发送者、群组等）确定会话 ID
      // 不同会话有不同的隔离级别和权限（会话 = 安全边界）
      const sessionId = this.sessionManager.resolveSessionId(message);
      console.log(`[Agent] 步骤1 - 会话解析: ${sessionId} (耗时 ${Date.now() - startTime}ms)`);

      // ======== 步骤 2: 上下文组装 (Context Assembly) ========
      // 加载会话历史 + 搜索相关记忆 + 从工作空间文件组装系统提示词
      const contextStart = Date.now();
      const context = await this._assembleContext(sessionId, message);
      console.log(`[Agent] 步骤2 - 上下文组装完成 (耗时 ${Date.now() - contextStart}ms)`);

      // ======== 步骤 3: 执行循环 (Execution Loop) ========
      // 核心循环：调用 LLM → 收到工具调用请求 → 执行工具 → 结果回传给 LLM → 循环
      const execStart = Date.now();
      const result = await this._executionLoop(context, messageId);
      console.log(`[Agent] 步骤3 - 执行循环完成 (耗时 ${Date.now() - execStart}ms)`);

      // ======== 步骤 4: 保存状态 (Save State) ========
      // 所有消息、工具调用结果存回磁盘，同时提取记忆
      await this._saveState(sessionId, message, result);
      console.log(`[Agent] 步骤4 - 状态已保存`);

      // 构造回复
      const response = {
        id: `resp_${Date.now()}`,
        messageId,
        sessionId,
        text: result.finalContent,
        toolCalls: result.toolCallLog,
        timestamp: Date.now(),
        processingTime: Date.now() - startTime,
      };

      // 发射"最终回复"事件 → Gateway 监听后路由到对应的渠道连接
      this.emit('agent:response', { messageId, response });
      console.log(`[Agent] 消息处理完成，总耗时 ${response.processingTime}ms`);

      return response;
    } catch (err) {
      console.error('[Agent] 处理消息出错:', err);

      // 发射"错误"事件 → Gateway 监听后向客户端返回错误信息
      this.emit('agent:error', { messageId, error: err });

      throw err;
    }
  }

  /**
   * 步骤 2: 上下文组装 (Context Assembly)
   *
   * OpenClaw 在每轮对话前组装 AI 所需的完整上下文，来源包括：
   *   a. 记忆系统 — 语义搜索与当前消息相关的历史记忆
   *   b. 工作空间文件 — AGENTS.md / SOUL.md / TOOLS.md / USER.md 等
   *   c. 会话历史 — 当前会话的对话记录
   *   d. 工具定义 — 所有可用工具的 JSON Schema 描述
   *
   * 这些信息一起构成发给 LLM 的完整请求。
   * OpenClaw 会智能筛选，只注入当前这轮需要的内容，避免提示词过长。
   */
  async _assembleContext(sessionId, message) {
    // 2a. 搜索相关记忆
    // OpenClaw 使用 embedding 向量 + 余弦相似度，简化版用关键词匹配
    const memories = this.memory.search(message.text, 3);
    if (memories.length > 0) {
      console.log(`[Agent]   找到 ${memories.length} 条相关记忆`);
    }

    // 2b. 组装系统提示词
    // PromptBuilder 每轮都从磁盘读取 workspace 文件（支持热更新）
    const systemPrompt = this.promptBuilder.build({
      memories,
      toolNames: this.toolSystem.getToolNames(),
      sessionId,
    });

    // 2c. 加载会话历史（如果历史过长会自动触发压缩）
    const history = this.sessionManager.getHistory(sessionId);

    // 2d. 获取工具定义（供 LLM 的 function calling 使用）
    const tools = this.toolSystem.getToolDefinitions();

    return { sessionId, systemPrompt, history, tools, currentMessage: message };
  }

  /**
   * 步骤 3: 执行循环 (Execution Loop)
   *
   * OpenClaw 的核心循环逻辑：
   *   1. 将上下文（system prompt + 历史 + 当前消息 + 工具定义）发送给 LLM
   *   2. LLM 返回回复，可能包含 tool_calls
   *   3. 如果有 tool_calls：
   *      a. 逐个执行工具
   *      b. 将 tool result 追加到消息列表
   *      c. 再次调用 LLM，让它基于工具结果继续生成
   *      d. 回到步骤 2
   *   4. 如果没有 tool_calls（finishReason === 'stop'）：返回最终文本
   *
   * 这个循环最多执行 maxToolRounds 次，防止 LLM 陷入无限工具调用
   *
   * @param {object} context - assembleContext 的返回值
   * @param {string} messageId - 消息 ID（用于事件关联）
   */
  async _executionLoop(context, messageId) {
    const { systemPrompt, history, tools, currentMessage } = context;

    // 构建发给 LLM 的消息列表（会话历史 + 当前用户消息）
    const messages = [
      ...history,
      { role: 'user', content: currentMessage.text },
    ];

    // 记录所有工具调用（用于调试和展示）
    const toolCallLog = [];

    let round = 0;
    while (round < this.maxToolRounds) {
      round++;
      console.log(`[Agent]   执行循环第 ${round} 轮`);

      // 调用 LLM（传入 system prompt、消息历史、工具定义）
      const llmResponse = await this.llmProvider.chat({
        systemPrompt,
        messages,
        tools,
      });

      // 情况 1：LLM 直接给出最终回复（无工具调用）
      if (llmResponse.finishReason === 'stop' || !llmResponse.toolCalls) {
        return {
          finalContent: llmResponse.content || '(无回复内容)',
          toolCallLog,
        };
      }

      // 情况 2：LLM 请求调用工具
      // 先将 assistant 的工具调用请求加入消息列表（保持对话完整性）
      messages.push({
        role: 'assistant',
        content: llmResponse.content || null,
        toolCalls: llmResponse.toolCalls,
      });

      // 依次执行每个工具调用
      for (const toolCall of llmResponse.toolCalls) {
        console.log(`[Agent]   调用工具: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

        // 发射工具调用事件 → Gateway 实时通知前端
        this.emit('agent:tool_call', {
          messageId,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          round,
        });

        // 执行工具
        const result = await this.toolSystem.execute(toolCall.name, toolCall.arguments);

        // 记录工具调用详情
        toolCallLog.push({
          name: toolCall.name,
          arguments: toolCall.arguments,
          result,
          round,
        });

        // 将工具执行结果追加到消息列表
        // toolCallId 关联请求和结果，LLM 据此理解哪个工具返回了什么
        messages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        });

        console.log(`[Agent]   工具 ${toolCall.name} 执行完成`);
      }

      // 继续循环，让 LLM 基于工具结果继续生成
    }

    // 超过最大轮数，安全退出
    return {
      finalContent: '抱歉，工具调用次数超过限制，已停止执行。',
      toolCallLog,
    };
  }

  /**
   * 步骤 4: 保存状态 (Save State)
   *
   * OpenClaw 在每轮对话结束后：
   *   1. 将用户消息、工具调用记录、AI 回复全部追加到会话历史
   *   2. 将用户消息中的重要信息提取到记忆系统
   *
   * 所有数据都存在本地磁盘，不上传到云端（OpenClaw 的"own your data"理念）
   */
  async _saveState(sessionId, message, result) {
    // 保存用户消息
    this.sessionManager.appendMessage(sessionId, {
      role: 'user',
      content: message.text,
    });

    // 如果有工具调用，保存工具调用记录
    if (result.toolCallLog && result.toolCallLog.length > 0) {
      const toolSummary = result.toolCallLog
        .map(tc => `[工具:${tc.name}] ${tc.result.slice(0, 100)}`)
        .join('\n');
      this.sessionManager.appendMessage(sessionId, {
        role: 'assistant',
        content: `[工具调用]\n${toolSummary}`,
      });
    }

    // 保存 AI 回复
    this.sessionManager.appendMessage(sessionId, {
      role: 'assistant',
      content: result.finalContent,
    });

    // 提取记忆
    // OpenClaw 的记忆系统会自动从对话中提取关键信息，供后续对话检索
    this.memory.save({
      content: message.text,
      sessionId,
      tags: ['conversation'],
    });
  }
}

module.exports = Agent;
