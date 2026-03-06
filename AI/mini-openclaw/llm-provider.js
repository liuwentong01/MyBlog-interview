/**
 * llm-provider.js - LLM 提供商
 *
 * 对应 OpenClaw 架构中的 Provider Plugin，负责：
 * 1. 统一的 LLM 调用接口（支持 Claude、GPT、Gemini 等）
 * 2. 流式响应处理
 * 3. 工具调用 (function calling) 的请求和解析
 *
 * OpenClaw 通过 ProviderPlugin 接口支持任意模型提供商。
 * 模型 API 调用走 Anthropic/OpenAI 等服务商，但所有调度逻辑留在本地。
 *
 * 本文件实现两种模式：
 * - MockLLMProvider：模拟 LLM（无需 API Key，用于演示和学习）
 * - RealLLMProvider：调用 OpenAI API（需要 API Key）
 */

const https = require('https');

// ========================================================================
// MockLLMProvider - 模拟 LLM
// 使用模式匹配来模拟真实 LLM 的行为，包括工具调用
// 适合在没有 API Key 的情况下学习和测试完整流程
// ========================================================================
class MockLLMProvider {
  constructor() {
    this.name = 'mock';
  }

  /**
   * 模拟 LLM 聊天接口
   *
   * @param {object} request
   *   - systemPrompt: string - 系统提示词
   *   - messages: Array<{ role, content, toolCallId?, toolCalls? }> - 对话历史
   *   - tools: Array - 可用工具定义
   * @returns {Promise<{ content, toolCalls, finishReason }>}
   */
  async chat(request) {
    const { messages, tools = [] } = request;
    const lastMsg = messages[messages.length - 1];
    const toolNames = tools.map(t => t.function.name);

    // 模拟网络延迟
    await this._delay(300 + Math.random() * 500);

    // 如果最后一条是工具执行结果，基于结果生成最终回复
    if (lastMsg.role === 'tool') {
      const toolResults = messages
        .filter(m => m.role === 'tool')
        .map(m => m.content);
      return {
        content: this._formatToolResults(toolResults),
        toolCalls: null,
        finishReason: 'stop',
      };
    }

    const text = (lastMsg.content || '').toLowerCase();

    // ---- 工具调用匹配 ----

    // 时间查询
    if (this._match(text, ['时间', '几点', '日期', 'time', 'date'])
        && toolNames.includes('get_current_time')) {
      return this._toolCallResponse('get_current_time', {});
    }

    // 列出文件
    if (this._match(text, ['列出文件', '文件列表', '目录', 'ls', 'list'])
        && toolNames.includes('list_files')) {
      const pathArg = this._extractQuoted(text) || '.';
      return this._toolCallResponse('list_files', { path: pathArg });
    }

    // 读取文件
    if (this._match(text, ['读取文件', '查看文件', '打开文件', '读文件', 'read', 'cat'])
        && toolNames.includes('read_file')) {
      const pathArg = this._extractQuoted(text) || 'package.json';
      return this._toolCallResponse('read_file', { path: pathArg });
    }

    // 执行命令
    if (this._match(text, ['执行', '运行', '命令', 'run', 'exec', 'shell'])
        && toolNames.includes('run_shell')) {
      const cmd = this._extractQuoted(text) || 'echo "Hello from Mini-OpenClaw!"';
      return this._toolCallResponse('run_shell', { command: cmd });
    }

    // 插件工具：打招呼（需要有明确的"给XX打招呼"模式才触发）
    if (this._match(text, ['打招呼', '问候', 'greet'])
        && toolNames.includes('greeting')) {
      const name = this._extractName(text) || '朋友';
      return this._toolCallResponse('greeting', { name });
    }

    // ---- 记忆相关 ----
    if (this._match(text, ['记住', '记忆', 'remember'])) {
      return {
        content: '好的，我会记住这些信息。在 OpenClaw 中，记忆系统会通过语义搜索在后续对话中自动检索相关记忆。',
        toolCalls: null,
        finishReason: 'stop',
      };
    }

    // ---- 关于自身 ----
    if (this._match(text, ['你是谁', '介绍', '什么是', 'openclaw', 'who are you'])) {
      return {
        content: [
          '我是 **Mini-OpenClaw** AI 助手，一个简化版的 OpenClaw 实现。',
          '',
          'OpenClaw 的核心架构包括：',
          '- **Gateway（网关）**：WebSocket 控制平面，负责消息路由',
          '- **Agent（智能体）**：AI 运行时，执行对话和工具调用',
          '- **Channel（渠道）**：连接各种聊天平台',
          '- **Tool System（工具系统）**：shell、文件操作等',
          '- **Session（会话）**：对话状态管理和自动压缩',
          '- **Memory（记忆）**：长期记忆存储和语义检索',
          '',
          '我可以帮你演示这些功能！',
        ].join('\n'),
        toolCalls: null,
        finishReason: 'stop',
      };
    }

    // ---- 默认回复 ----
    return {
      content: [
        `你好！我收到了你的消息："${lastMsg.content}"`,
        '',
        '我可以帮你做这些事情：',
        '- 🕐 查询时间（试试"现在几点"）',
        '- 📁 列出文件（试试"列出文件"）',
        '- 📄 读取文件（试试"读取文件 \'package.json\'"）',
        '- 💻 执行命令（试试"执行命令 \'node -v\'"）',
        '- 👋 打招呼（试试"给小明打招呼"）',
        '- ❓ 了解架构（试试"你是谁"）',
        '',
        '当前运行在 Mock 模式，不需要 API Key。',
      ].join('\n'),
      toolCalls: null,
      finishReason: 'stop',
    };
  }

  // ========== 辅助方法 ==========

  _toolCallResponse(name, args) {
    return {
      content: null,
      toolCalls: [{
        id: `call_${Date.now()}`,
        name,
        arguments: args,
      }],
      finishReason: 'tool_calls',
    };
  }

  _match(text, keywords) {
    return keywords.some(kw => text.includes(kw));
  }

  _extractQuoted(text) {
    const match = text.match(/['"`''""]([^'"`''""]+)['"`''""]/);
    return match ? match[1] : null;
  }

  _extractAfter(text, prefix) {
    const idx = text.indexOf(prefix);
    if (idx === -1) return null;
    const after = text.slice(idx + prefix.length).trim();
    return after.split(/\s/)[0] || null;
  }

  _extractName(text) {
    // 匹配 "给XX打招呼" / "跟XX问候" 等模式
    const match = text.match(/[给跟向对]\s*(.+?)\s*(?:打招呼|问候|问好)/);
    if (match) return match[1];
    // 匹配 "greet XX"
    const match2 = text.match(/greet\s+(\S+)/);
    if (match2) return match2[1];
    return null;
  }

  _formatToolResults(results) {
    if (results.length === 1) {
      return `好的，这是结果：\n\n${results[0]}`;
    }
    return `以下是执行结果：\n\n${results.map((r, i) => `**结果 ${i + 1}:**\n${r}`).join('\n\n')}`;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========================================================================
// RealLLMProvider - 真实 LLM API 调用
// 调用 OpenAI Chat Completions API（也兼容其他 OpenAI 兼容的 API）
// ========================================================================
class RealLLMProvider {
  constructor(config = {}) {
    this.name = 'real';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.model = config.model || 'gpt-4o-mini';

    if (!this.apiKey) {
      throw new Error('RealLLMProvider 需要 OPENAI_API_KEY 环境变量或 config.apiKey');
    }
  }

  async chat(request) {
    const { systemPrompt, messages, tools } = request;

    // 构建 OpenAI 格式的消息
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(msg => {
        if (msg.role === 'tool') {
          return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId };
        }
        if (msg.toolCalls) {
          return {
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        return { role: msg.role, content: msg.content };
      }),
    ];

    const body = {
      model: this.model,
      messages: apiMessages,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const data = await this._post('/v1/chat/completions', body);
    const choice = data.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      return {
        content: choice.message.content,
        toolCalls: choice.message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
        finishReason: 'tool_calls',
      };
    }

    return {
      content: choice.message.content,
      toolCalls: null,
      finishReason: 'stop',
    };
  }

  _post(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const postData = JSON.stringify(body);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`API 错误 (${res.statusCode}): ${parsed.error?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`解析响应失败: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
}

// ========================================================================
// 工厂函数：根据配置创建对应的 LLM Provider
// ========================================================================
function createLLMProvider(config = {}) {
  const type = config.type || process.env.OPENCLAW_LLM || 'mock';

  if (type === 'real') {
    console.log('[LLM] 使用真实 LLM API (OpenAI 兼容)');
    return new RealLLMProvider(config);
  }

  console.log('[LLM] 使用 Mock LLM（无需 API Key，适合学习和测试）');
  return new MockLLMProvider();
}

module.exports = { MockLLMProvider, RealLLMProvider, createLLMProvider };
