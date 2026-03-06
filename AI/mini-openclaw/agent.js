/**
 * agent.js - Agent 运行时（核心引擎）
 *
 * 对应 OpenClaw 架构中的 Agent Runtime，是整个系统最核心的部分。
 *
 * Agent 是真正执行 AI 对话和工具调用的地方，相当于 AI 的"工作台"。
 * 每轮对话严格执行四个步骤：
 *
 *   步骤 1：会话解析 (Session Resolution)
 *           → 根据消息来源确定属于哪个会话
 *
 *   步骤 2：上下文组装 (Context Assembly)
 *           → 加载会话历史 + 搜索相关记忆 + 拼装系统提示词
 *
 *   步骤 3：执行循环 (Execution Loop)
 *           → 调用 LLM → 如果有工具调用 → 执行工具 → 将结果回传给 LLM → 循环
 *
 *   步骤 4：保存状态 (Save State)
 *           → 将对话记录和工具调用结果存入会话历史
 *
 * OpenClaw 的 Agent 还支持多 Agent 路由（不同渠道用不同 Agent 实例），
 * 以及 Agent 间通信（sessions_spawn, sessions_send 等工具）。
 * 简化版只实现单 Agent。
 */

const EventEmitter = require('events');

class Agent extends EventEmitter {
  /**
   * @param {object} deps - 依赖注入
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
    this.maxToolRounds = 5;
  }

  /**
   * 处理一条消息的完整生命周期
   *
   * 这是 Agent 的核心方法，对应 OpenClaw 文档中描述的
   * "一条消息从接收到回复的完整生命周期"。
   *
   * @param {object} message - 收到的消息
   *   { id, channelType, senderId, senderName, text, timestamp, peerKind, groupId }
   * @returns {Promise<object>} 回复消息
   */
  async processMessage(message) {
    const startTime = Date.now();

    try {
      // ======== 步骤 1: 会话解析 (Session Resolution) ========
      // 根据消息的来源（渠道类型、发送者、群组等）确定会话 ID
      // 不同会话有不同的隔离级别和权限
      const sessionId = this.sessionManager.resolveSessionId(message);
      console.log(`[Agent] 步骤1 - 会话解析: ${sessionId} (耗时 ${Date.now() - startTime}ms)`);

      // ======== 步骤 2: 上下文组装 (Context Assembly) ========
      const contextStart = Date.now();
      const context = await this._assembleContext(sessionId, message);
      console.log(`[Agent] 步骤2 - 上下文组装完成 (耗时 ${Date.now() - contextStart}ms)`);

      // ======== 步骤 3: 执行循环 (Execution Loop) ========
      // 调用 LLM，如果 LLM 请求工具调用则执行工具并循环
      const execStart = Date.now();
      const result = await this._executionLoop(context);
      console.log(`[Agent] 步骤3 - 执行循环完成 (耗时 ${Date.now() - execStart}ms)`);

      // ======== 步骤 4: 保存状态 (Save State) ========
      await this._saveState(sessionId, message, result);
      console.log(`[Agent] 步骤4 - 状态已保存`);

      // 构造回复
      const response = {
        id: `resp_${Date.now()}`,
        sessionId,
        text: result.finalContent,
        toolCalls: result.toolCallLog,
        timestamp: Date.now(),
        processingTime: Date.now() - startTime,
      };

      // 发射事件（供 Gateway 监听并广播）
      this.emit('response', response);
      console.log(`[Agent] 消息处理完成，总耗时 ${response.processingTime}ms`);

      return response;
    } catch (err) {
      console.error('[Agent] 处理消息出错:', err);
      const errorResponse = {
        id: `resp_${Date.now()}`,
        text: `抱歉，处理消息时出现了错误：${err.message}`,
        toolCalls: null,
        timestamp: Date.now(),
        processingTime: Date.now() - startTime,
      };
      this.emit('response', errorResponse);
      return errorResponse;
    }
  }

  /**
   * 步骤 2: 上下文组装
   *
   * OpenClaw 在每轮对话前组装 AI 所需的完整上下文：
   * 1. 从记忆系统中搜索与当前消息语义相关的历史记忆
   * 2. 从工作空间读取配置文件（AGENTS.md, SOUL.md 等）
   * 3. 加载当前会话的对话历史
   * 4. 生成工具定义列表
   *
   * 这些信息一起构成发给 LLM 的完整请求
   */
  async _assembleContext(sessionId, message) {
    // 2a. 搜索相关记忆（OpenClaw 用语义搜索/向量相似度）
    const memories = this.memory.search(message.text, 3);
    if (memories.length > 0) {
      console.log(`[Agent]   找到 ${memories.length} 条相关记忆`);
    }

    // 2b. 组装系统提示词（从工作空间文件 + 记忆 + 运行时信息）
    const systemPrompt = this.promptBuilder.build({
      memories,
      toolNames: this.toolSystem.getToolNames(),
      sessionId,
    });

    // 2c. 加载会话历史
    const history = this.sessionManager.getHistory(sessionId);

    // 2d. 获取工具定义
    const tools = this.toolSystem.getToolDefinitions();

    return {
      sessionId,
      systemPrompt,
      history,
      tools,
      currentMessage: message,
    };
  }

  /**
   * 步骤 3: 执行循环 (Execution Loop)
   *
   * OpenClaw 的核心循环逻辑：
   *   1. 将上下文发送给 LLM
   *   2. LLM 返回回复（可能包含工具调用）
   *   3. 如果有工具调用：
   *      a. 执行每个工具
   *      b. 将工具结果追加到消息列表
   *      c. 重新调用 LLM（回到步骤 1）
   *   4. 如果没有工具调用：返回最终内容
   *
   * 这个循环最多执行 maxToolRounds 次，防止无限循环
   */
  async _executionLoop(context) {
    const { systemPrompt, history, tools, currentMessage } = context;

    // 构建消息列表（会话历史 + 当前消息）
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

      // 调用 LLM
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
      // 先将 assistant 的工具调用请求加入消息列表
      messages.push({
        role: 'assistant',
        content: llmResponse.content || null,
        toolCalls: llmResponse.toolCalls,
      });

      // 依次执行每个工具调用
      for (const toolCall of llmResponse.toolCalls) {
        console.log(`[Agent]   调用工具: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

        // 发射工具调用事件（实时通知前端）
        this.emit('tool_call', {
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          round,
        });

        // 执行工具
        const result = await this.toolSystem.execute(toolCall.name, toolCall.arguments);

        // 记录工具调用
        toolCallLog.push({
          name: toolCall.name,
          arguments: toolCall.arguments,
          result,
          round,
        });

        // 将工具结果追加到消息列表，供 LLM 下一轮使用
        // 注意 toolCallId 用于关联请求和结果
        messages.push({
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
        });

        console.log(`[Agent]   工具 ${toolCall.name} 执行完成`);
      }

      // 继续循环，让 LLM 基于工具结果继续生成
    }

    // 超过最大轮数
    return {
      finalContent: '抱歉，工具调用次数超过限制，已停止执行。',
      toolCallLog,
    };
  }

  /**
   * 步骤 4: 保存状态
   *
   * OpenClaw 在每轮对话结束后，将所有消息和工具调用结果存回磁盘。
   * 同时将重要信息提取到记忆系统中。
   */
  async _saveState(sessionId, message, result) {
    // 保存用户消息
    this.sessionManager.appendMessage(sessionId, {
      role: 'user',
      content: message.text,
    });

    // 如果有工具调用，也保存工具调用记录
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

    // 提取记忆（简化版：将用户消息存入记忆系统）
    this.memory.save({
      content: message.text,
      sessionId,
      tags: ['conversation'],
    });
  }
}

module.exports = Agent;
