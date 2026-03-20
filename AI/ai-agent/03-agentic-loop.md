# 03 - Agentic Loop：核心消息循环

> 这是 Claude Code 架构中**最核心**的模块。整个 Agent 系统的"智能"和"自主性"都来源于这个循环。理解了 Agentic Loop，就理解了 AI Agent 的灵魂。

---

## 目录

1. [为什么 Agentic Loop 是核心](#1-为什么-agentic-loop-是核心)
2. [循环流程详解](#2-循环流程详解)
3. [实现类 uFq 分析（SDK 的 Conversation 实现）](#3-实现类-ufq-分析sdk-的-conversation-实现)
4. [关键特性深入](#4-关键特性深入)
5. [Async Generator 模式的优势](#5-async-generator-模式的优势)
6. [与 ReAct 模式的对比](#6-与-react-reasoning--acting-模式的对比)
7. [伪代码示例](#7-伪代码示例)

---

## 1. 为什么 Agentic Loop 是核心

### 1.1 区别于传统的 request-response 模式

传统的 LLM 应用（如 ChatGPT 网页版）是一个简单的 **request-response** 模式：

```
用户提问 ──→ LLM ──→ 回答
   (一问)         (一答)
```

这种模式下，LLM 是被动的——用户问什么答什么，每次交互都是独立的。LLM 没有能力"主动做事"。

而 Agentic Loop 是一个根本性的范式转换：

```
用户提问 ──→ LLM 思考 ──→ 决定调用工具 ──→ 拿到结果 ──→ 继续思考 ──→ 可能再调用工具 ──→ ... ──→ 最终回答
              ↑                                            |
              └────────── 自动循环，无需人工干预 ─────────────┘
```

**关键区别：**

| 维度 | 传统 request-response | Agentic Loop |
|------|----------------------|--------------|
| 交互次数 | 1 次 LLM 调用 | N 次 LLM 调用（自动） |
| LLM 角色 | 回答者 | 决策引擎 |
| 工具使用 | 无或手动编排 | 模型自主决定 |
| 停止条件 | 生成完毕即停 | 模型判断"任务完成"才停 |
| 类比 | 搜索引擎 | 一个会自己操作电脑的程序员 |

### 1.2 Agent 的"自主性"来源于这个循环

"自主性"这个词听起来很玄，但落到代码层面，就是一个 **while 循环**。Agent 的自主性来自于：

1. **模型决定下一步做什么**：不是开发者硬编码"先搜索再写代码"，而是模型根据当前上下文自行判断
2. **模型决定何时停止**：返回 `end_turn` 而非 `tool_use` 时循环结束
3. **工具结果反馈形成闭环**：每次工具执行的结果都会送回模型，模型据此决定下一步

这就是为什么同样的 Claude 3.5 Sonnet 模型，在 ChatGPT 式的聊天界面里只能"说"，而在 Claude Code 里能"做"——**差别不在模型，在于这个循环机制**。

```
传统模式：  User → LLM → Response      （LLM 是函数）
Agent 模式：User → [LLM ⇄ Tools]* → Response  （LLM 是循环中的决策节点）

* 表示循环 0 到 N 次
```

---

## 2. 循环流程详解

### 2.1 完整流程 ASCII 图

```
                              submitMessage(用户输入)
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │   构建 System Prompt          │
                        │   + 用户上下文                 │
                        │   + 环境信息 (cwd, OS, etc.)  │
                        └──────────────┬───────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │   注册所有可用工具              │
                        │   (Bash, Read, Write, Edit,   │
                        │    Glob, Grep, MCP tools...)  │
                        └──────────────┬───────────────┘
                                       │
                                       ▼
               ┌═══════════════════════════════════════════════┐
               ║           进入 th() 主循环                     ║
               ║         (async generator)                     ║
               ╠═══════════════════════════════════════════════╣
               ║                                               ║
               ║    ┌─────────────────────────────────┐        ║
               ║    │  检查预算 & 轮次限制              │        ║
               ║    │  (maxTurns / maxBudgetUsd)       │        ║
               ║    └──────────────┬──────────────────┘        ║
               ║                   │                           ║
               ║                   ▼                           ║
               ║    ┌─────────────────────────────────┐        ║
               ║    │  调用 Anthropic Messages API     │        ║
               ║    │  (streaming 模式)                │        ║
               ║    │                                 │        ║
               ║    │  请求体:                         │        ║
               ║    │  {                              │        ║
               ║    │    model, system, messages,     │        ║
               ║    │    tools, max_tokens,           │        ║
               ║    │    stream: true                  │        ║
               ║    │  }                              │        ║
               ║    └──────────────┬──────────────────┘        ║
               ║                   │                           ║
               ║                   ▼                           ║
               ║    ┌─────────────────────────────────┐        ║
               ║    │  处理 streaming 响应              │        ║
               ║    │  逐 token 收集内容               │        ║
               ║    │  yield 中间状态给 UI 层           │        ║
               ║    └──────────────┬──────────────────┘        ║
               ║                   │                           ║
               ║                   ▼                           ║
               ║         ┌─────────────────────┐               ║
               ║         │  解析 stop_reason    │               ║
               ║         └────────┬────────────┘               ║
               ║                  │                            ║
               ║        ┌────────┼────────────┐                ║
               ║        ▼        ▼            ▼                ║
               ║   "end_turn" "tool_use"  "thinking"           ║
               ║        │        │            │                ║
               ║        │        │            │                ║
               ║        ▼        │            ▼                ║
               ║   ┌────────┐   │     ┌───────────────┐       ║
               ║   │ 退出   │   │     │ 记录 thinking │       ║
               ║   │ 循环   │   │     │ 继续处理      │       ║
               ║   └────────┘   │     └───────────────┘       ║
               ║                │                              ║
               ║                ▼                              ║
               ║   ┌──────────────────────────────────┐        ║
               ║   │        tool_use 分支              │        ║
               ║   │                                  │        ║
               ║   │  1. 解析 tool_name + input       │        ║
               ║   │  2. 权限检查                      │        ║
               ║   │     ├─ 已授权 → 继续              │        ║
               ║   │     ├─ 需确认 → yield 等待用户    │        ║
               ║   │     └─ 拒绝   → 生成拒绝 result   │        ║
               ║   │  3. 执行工具函数                   │        ║
               ║   │  4. 收集 tool_result              │        ║
               ║   │  5. 将 result 追加到 messages     │        ║
               ║   └──────────────┬───────────────────┘        ║
               ║                  │                            ║
               ║                  ▼                            ║
               ║          回到循环顶部 ─────────────────────→   ║
               ║          (再次调用 LLM)                       ║
               ╚═══════════════════════════════════════════════╝
                                       │
                                       │ (end_turn)
                                       ▼
                        ┌──────────────────────────────┐
                        │   返回最终结果                  │
                        │   (文本 + 工具调用记录)         │
                        └──────────────────────────────┘
```

### 2.2 各步骤详细分析

#### Step 1: submitMessage（用户输入）

用户在终端输入一条消息后，CLI 层将其封装为结构化的消息对象，传入 Agentic Loop：

```typescript
// 用户输入 "帮我重构 utils.ts 中的 debounce 函数"
// 被封装为：
{
  role: "user",
  content: [
    { type: "text", text: "帮我重构 utils.ts 中的 debounce 函数" }
  ]
}
```

这条消息会被追加到 `messages` 数组中，该数组是整个对话的完整历史。

#### Step 2: 构建 System Prompt + 用户上下文

System Prompt 不是一个静态字符串，而是每次循环前**动态组装**的。包含：

- **基础身份定义**：你是 Claude，一个 AI 助手……
- **工具使用说明**：如何使用 Bash、Read、Write 等工具
- **环境信息**：当前工作目录 (`cwd`)、操作系统、Shell 类型
- **项目上下文**：CLAUDE.md 文件内容（如果存在）
- **会话历史摘要**：如果历史过长，会进行压缩

```
System Prompt = 基础模板
  + 工具描述（动态，根据注册的工具生成）
  + 环境变量（cwd, platform, shell）
  + CLAUDE.md 内容
  + 会话上下文/压缩摘要
```

#### Step 3: 注册所有可用工具

工具以 JSON Schema 的形式注册给 Anthropic API。每个工具包含：

```typescript
{
  name: "Bash",
  description: "Executes a given bash command...",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      timeout: { type: "number", description: "Timeout in ms" }
    },
    required: ["command"]
  }
}
```

模型**不直接执行工具**，它只是在响应中表达"我想调用某个工具"，由客户端代码实际执行。

#### Step 4: 进入 th() 主循环（async generator）

这是核心中的核心。`th()` 方法是一个 `async generator`，每次 `yield` 产出一个中间事件（如文本片段、工具调用状态等），外层消费者（UI 层）可以实时展示进度。

```typescript
async function* th(messages, tools, systemPrompt, options) {
  let turn = 0;

  while (turn < options.maxTurns) {
    turn++;

    // 调用 API
    const stream = await callAnthropicAPI(messages, tools, systemPrompt);

    // 处理流式响应
    const response = yield* processStream(stream);

    // 将 assistant 消息追加到历史
    messages.push({ role: "assistant", content: response.content });

    // 检查是否有 tool_use
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      // 没有工具调用，退出循环
      return;
    }

    // 执行所有工具调用
    const toolResults = [];
    for (const block of toolUseBlocks) {
      yield { type: "tool_start", name: block.name };
      const result = await executeTool(block.name, block.input);
      yield { type: "tool_result", name: block.name, result };
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result
      });
    }

    // 将工具结果追加到消息，进入下一轮
    messages.push({ role: "user", content: toolResults });
  }
}
```

#### Step 5: 调用 Anthropic Messages API（streaming）

每一轮循环都会发起一次 API 调用。请求结构：

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 16384,
  "system": "<动态组装的 system prompt>",
  "messages": [
    { "role": "user", "content": "帮我重构 utils.ts 中的 debounce 函数" },
    { "role": "assistant", "content": [
      { "type": "tool_use", "id": "toolu_01", "name": "Read", "input": {"file_path": "utils.ts"} }
    ]},
    { "role": "user", "content": [
      { "type": "tool_result", "tool_use_id": "toolu_01", "content": "..." }
    ]},
    // ... 更多轮次
  ],
  "tools": [ /* 工具定义 */ ],
  "stream": true
}
```

注意 `messages` 数组会随着循环进行越来越长，因为每一轮的 assistant 响应和 tool_result 都会追加进去。这就是"上下文累积"。

#### Step 6: 模型返回处理

模型的 streaming 响应包含多种 content block 类型：

**text 类型** - 普通文本输出：
```json
{ "type": "text", "text": "让我先看一下这个文件..." }
```

**tool_use 类型** - 工具调用请求：
```json
{
  "type": "tool_use",
  "id": "toolu_01XYZ",
  "name": "Read",
  "input": { "file_path": "/path/to/utils.ts" }
}
```

**thinking 类型** - 扩展思考（Extended Thinking）：
```json
{ "type": "thinking", "thinking": "用户想要重构 debounce，我需要先读取文件内容..." }
```

一次响应中可以同时包含多种类型。例如模型可能先输出一段 text，然后跟一个 tool_use。

#### Step 7: tool_use 分支详解

当响应中包含 `tool_use` block 时，进入工具执行流程：

```
tool_use block 解析
        │
        ▼
┌────────────────┐
│  权限检查       │
│  (Permission   │
│   System)      │
└───────┬────────┘
        │
   ┌────┼────────────────┐
   ▼    ▼                ▼
 允许  需要确认          拒绝
   │    │                │
   │    ▼                ▼
   │  yield 暂停      构造拒绝的
   │  等待用户确认     tool_result
   │  (y/n)            │
   │    │               │
   │    ├─ 确认 ─→ 继续 │
   │    └─ 拒绝 ─→ 构造拒绝 result
   │         │
   ▼         ▼
┌────────────────┐
│  执行工具函数    │
│  (可能是:       │
│   - Bash 命令   │
│   - 文件读写    │
│   - MCP 调用    │
│   - 子 Agent)   │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  构造           │
│  tool_result    │
│  {              │
│    type:        │
│    "tool_result"│
│    tool_use_id: │
│    content: ... │
│  }              │
└───────┬────────┘
        │
        ▼
  追加到 messages
  继续下一轮循环
```

**权限检查**是 Claude Code 安全模型的核心。不同工具有不同的权限等级：
- **总是允许**：Read、Glob、Grep（只读操作）
- **需要确认**：Bash（可能执行危险命令）、Write（修改文件）
- **根据规则判断**：通过 `.claude/settings.json` 中的 allow/deny 规则

#### Step 8: end_turn 退出条件

循环在以下情况退出：

1. **模型主动停止**：`stop_reason === "end_turn"`，模型认为任务已完成
2. **达到最大轮次**：`turn >= maxTurns`，安全阀机制
3. **预算耗尽**：`totalCost >= maxBudgetUsd`
4. **用户中断**：通过 `AbortController` 发出取消信号
5. **致命错误**：API 调用失败且重试耗尽

**重点理解**：在正常情况下，**是模型自己决定何时停止的**。这就是"自主性"的直接体现——开发者不硬编码循环次数，模型自己判断"我已经完成了用户交给我的任务"。

---

## 3. 实现类 uFq 分析（SDK 的 Conversation 实现）

在 Claude Code 的打包代码中，核心的 Agentic Loop 实现被混淆为类名 `uFq`。通过逆向分析，可以还原其设计：

### 3.1 类结构概览

```typescript
class uFq {
  // ====== 核心属性 ======
  private messages: Message[];          // 完整对话历史
  private tools: Tool[];                // 注册的工具集合
  private systemPrompt: string;         // 系统提示词
  private model: string;                // 模型名称
  private apiKey: string;               // API 密钥
  private maxTurns: number;             // 最大循环轮次
  private maxBudgetUsd: number;         // 最大预算（美元）
  private abortController: AbortController; // 中断控制器

  // ====== 状态追踪 ======
  private turnCount: number;            // 当前轮次
  private totalInputTokens: number;     // 累计输入 token
  private totalOutputTokens: number;    // 累计输出 token
  private totalCostUsd: number;         // 累计花费

  // ====== 核心方法 ======
  async *run(userMessage: string): AsyncGenerator<AgenticEvent>;
  private async *th(): AsyncGenerator<AgenticEvent>;  // 主循环
  private async callAPI(): Promise<APIResponse>;
  private async executeTool(toolUse: ToolUseBlock): Promise<ToolResult>;
  private checkBudget(): boolean;
  private buildMessages(): Message[];
}
```

### 3.2 关键方法分析

#### `run()` - 入口方法

```typescript
async *run(userMessage: string): AsyncGenerator<AgenticEvent> {
  // 1. 追加用户消息
  this.messages.push({
    role: "user",
    content: [{ type: "text", text: userMessage }]
  });

  // 2. 进入主循环
  yield* this.th();

  // 3. 返回最终消息列表
  yield { type: "complete", messages: this.messages };
}
```

#### `th()` - 主循环（核心）

`th()` 是 `uFq` 中最关键的方法。名字虽然被混淆了，但功能非常清晰——它实现了完整的 Agentic Loop：

```typescript
private async *th(): AsyncGenerator<AgenticEvent> {
  while (true) {
    // ---- 预检 ----
    if (this.turnCount >= this.maxTurns) {
      yield { type: "max_turns_reached" };
      return;
    }
    if (this.totalCostUsd >= this.maxBudgetUsd) {
      yield { type: "budget_exceeded" };
      return;
    }
    if (this.abortController.signal.aborted) {
      yield { type: "aborted" };
      return;
    }

    this.turnCount++;

    // ---- 调用 API (streaming) ----
    yield { type: "api_call_start", turn: this.turnCount };

    const stream = await this.callAPI();
    const contentBlocks: ContentBlock[] = [];
    let stopReason: string;

    // ---- 处理 streaming 事件 ----
    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start":
          // 新的 content block 开始（text / tool_use / thinking）
          yield { type: "block_start", block: event.content_block };
          break;

        case "content_block_delta":
          // 增量内容（streaming 的核心）
          if (event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            // tool_use 的参数是 streaming JSON
            yield { type: "tool_input_delta", delta: event.delta.partial_json };
          } else if (event.delta.type === "thinking_delta") {
            yield { type: "thinking", text: event.delta.thinking };
          }
          break;

        case "content_block_stop":
          contentBlocks.push(event.content_block);
          break;

        case "message_stop":
          stopReason = event.message.stop_reason;
          // 更新 token 计数
          this.totalInputTokens += event.message.usage.input_tokens;
          this.totalOutputTokens += event.message.usage.output_tokens;
          this.totalCostUsd = this.calculateCost();
          break;
      }
    }

    // ---- 将 assistant 消息加入历史 ----
    this.messages.push({
      role: "assistant",
      content: contentBlocks
    });

    // ---- 检查退出条件 ----
    if (stopReason === "end_turn") {
      yield { type: "turn_complete", reason: "end_turn" };
      return;  // 模型决定停止，退出循环
    }

    // ---- 处理 tool_use ----
    if (stopReason === "tool_use") {
      const toolUseBlocks = contentBlocks.filter(b => b.type === "tool_use");
      const toolResults: ToolResultBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        // 权限检查
        const permission = await this.checkPermission(toolUse);
        if (permission === "denied") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Permission denied by user",
            is_error: true
          });
          continue;
        }

        // 执行工具
        yield { type: "tool_executing", name: toolUse.name, input: toolUse.input };
        const result = await this.executeTool(toolUse);
        yield { type: "tool_done", name: toolUse.name, result };

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.output,
          is_error: result.isError
        });
      }

      // 将 tool_result 作为 user 消息追加
      this.messages.push({
        role: "user",
        content: toolResults
      });

      // 继续循环！不 return，回到 while(true) 顶部
      continue;
    }
  }
}
```

### 3.3 消息流转的数据模型

每一轮循环中，`messages` 数组的增长模式：

```
初始状态:
  messages = [
    { role: "user", content: "帮我读取 main.ts" }
  ]

第 1 轮 LLM 响应后:
  messages = [
    { role: "user", content: "帮我读取 main.ts" },
    { role: "assistant", content: [
      { type: "text", text: "好的，让我读取这个文件。" },
      { type: "tool_use", id: "toolu_01", name: "Read",
        input: { file_path: "/project/main.ts" } }
    ]}
  ]

工具执行后:
  messages = [
    { role: "user", content: "帮我读取 main.ts" },
    { role: "assistant", content: [...] },
    { role: "user", content: [
      { type: "tool_result", tool_use_id: "toolu_01",
        content: "1: import express...\n2: const app = ..." }
    ]}
  ]

第 2 轮 LLM 响应后 (end_turn):
  messages = [
    { role: "user", content: "帮我读取 main.ts" },
    { role: "assistant", content: [...] },
    { role: "user", content: [{ type: "tool_result", ... }] },
    { role: "assistant", content: [
      { type: "text", text: "这个文件是一个 Express 服务器，包含以下功能..." }
    ]}
  ]
```

**重要细节：tool_result 是以 `role: "user"` 的身份追加的**。这是 Anthropic Messages API 的协议设计——从 API 的视角看，对话永远是 user-assistant 交替进行，tool_result 被视为"用户"提供的上下文。

### 3.4 uFq 与外部系统的交互

```
                  ┌─────────────────────────────────────────┐
                  │                  uFq                     │
                  │         (Conversation / 主循环)          │
                  │                                         │
  submitMessage   │   messages[]     th() generator         │
  ───────────────→│   ┌──────────┐   ┌──────────────┐      │
                  │   │ user msg │──→│ callAPI()    │      │
                  │   │ asst msg │←──│ processResp()│      │
                  │   │ tool_res │──→│ executeTool()│      │
                  │   │ ...      │   └──────────────┘      │
                  │   └──────────┘          │               │
                  │                         │ yield         │
                  └─────────────────────────┼───────────────┘
                                            │
                  ┌─────────────────────────┼───────────────┐
                  │        UI Layer         ▼               │
                  │   for await (event of conversation) {   │
                  │     render(event);                      │
                  │   }                                     │
                  └─────────────────────────────────────────┘
```

---

## 4. 关键特性深入

### 4.1 Streaming 模式：为什么用 streaming 而不是一次返回

Claude Code 使用 **Server-Sent Events (SSE)** 进行 streaming，而不是等待完整响应。原因有三：

**用户体验**：
- 模型生成 2000 个 token 可能需要 10-30 秒
- 一次返回 = 用户盯着空白等 30 秒
- Streaming = 用户实时看到文字逐字出现，感知延迟从 30 秒降到 ~200ms

**内存效率**：
- 模型可能生成很长的响应（如完整的文件内容）
- Streaming 允许逐步处理，不需要一次性将完整响应加载到内存

**中断能力**：
- 如果模型开始输出错误方向的内容，用户可以提前中断（Ctrl+C）
- 非 streaming 模式下，必须等到完整响应后才能取消

streaming 事件的类型与处理：

```typescript
// SSE 事件流示例
event: message_start
data: {"type":"message_start","message":{"id":"msg_01","model":"claude-sonnet-4-20250514",...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"让我"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"看看"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"这个文件"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"Read"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"path\":\"/src/main.ts\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_stop
data: {"type":"message_stop","stop_reason":"tool_use"}
```

注意 **tool_use 的参数也是 streaming 的**——JSON 参数是分片传输的（`input_json_delta`），需要客户端拼接后再解析。

### 4.2 多轮自动执行：模型决定何时停止

这是 Agentic Loop 最精妙的设计之一。考虑用户请求 "帮我把项目中所有的 var 改成 const"，模型可能的执行轨迹：

```
Turn 1: 调用 Grep 搜索所有包含 var 的文件
Turn 2: 调用 Read 读取第一个文件
Turn 3: 调用 Edit 修改第一个文件
Turn 4: 调用 Read 读取第二个文件
Turn 5: 调用 Edit 修改第二个文件
...
Turn N: 所有文件改完了，输出文本总结 → end_turn
```

**模型通过以下方式判断"任务完成"：**

1. 所有相关文件都已处理完毕
2. 工具返回的结果显示没有更多匹配项
3. 模型的内部推理认为任务目标已达成

开发者不需要写任何"检查是否完成"的逻辑——这完全由模型的推理能力驱动。

### 4.3 预算控制：maxTurns 和 maxBudgetUsd

虽然模型自主决定何时停止，但仍需安全机制防止失控：

```typescript
interface LoopOptions {
  maxTurns: number;        // 最大循环轮次，默认通常为 ~100
  maxBudgetUsd: number;    // 最大花费（美元），防止意外巨额账单
}
```

**maxTurns（轮次限制）**：

每次 API 调用算一轮。如果模型需要修改 200 个文件，每个文件需要 Read + Edit 两次 API 调用，那就是 400 轮。超过限制后循环强制退出。

```typescript
// 预算检查逻辑
if (this.turnCount >= this.maxTurns) {
  yield {
    type: "system_message",
    text: `已达到最大轮次限制 (${this.maxTurns})，停止执行。`
  };
  return;
}
```

**maxBudgetUsd（花费限制）**：

每轮 API 调用后累加 token 花费：

```typescript
// 价格计算（以 Claude 3.5 Sonnet 为例）
const INPUT_PRICE_PER_MTK = 3;    // $3 / 1M input tokens
const OUTPUT_PRICE_PER_MTK = 15;  // $15 / 1M output tokens

calculateCost() {
  return (this.totalInputTokens * INPUT_PRICE_PER_MTK / 1_000_000) +
         (this.totalOutputTokens * OUTPUT_PRICE_PER_MTK / 1_000_000);
}
```

### 4.4 中断支持：AbortController 模式

Claude Code 使用标准的 Web API `AbortController` 实现中断：

```typescript
const controller = new AbortController();

// 用户按 Ctrl+C
process.on("SIGINT", () => {
  controller.abort();
});

// 在循环中检查
async function* th() {
  while (true) {
    if (controller.signal.aborted) {
      yield { type: "aborted" };
      return;
    }

    // API 调用也传入 signal，支持中途取消
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      body: JSON.stringify(requestBody),
      signal: controller.signal,  // <-- 传入 AbortSignal
      headers: { ... }
    });

    // streaming 过程中也可以检查
    for await (const chunk of response.body) {
      if (controller.signal.aborted) break;
      // 处理 chunk...
    }
  }
}
```

中断的优雅之处在于：
- API 请求可以被立即取消（TCP 连接断开）
- 已接收的部分响应仍然保留在 messages 中
- 下次继续时，模型可以看到之前的上下文

### 4.5 结构化输出：JSON Schema 验证

当需要模型返回结构化数据时（而非自由文本），Agentic Loop 支持 JSON Schema 验证：

```typescript
// 请求模型返回符合 schema 的 JSON
const response = await callAPI({
  messages,
  tools,
  // 要求结构化输出
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "code_analysis",
      schema: {
        type: "object",
        properties: {
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file: { type: "string" },
                line: { type: "number" },
                severity: { type: "string", enum: ["error", "warning", "info"] },
                message: { type: "string" }
              },
              required: ["file", "line", "severity", "message"]
            }
          }
        },
        required: ["issues"]
      }
    }
  }
});
```

在 Claude Code 中，这主要用于内部的子任务（如 lint 检查结果解析、任务分解等），而非直接面向用户。

---

## 5. Async Generator 模式的优势

### 5.1 为什么选择 async generator 而不是普通 async/await

**方案对比：**

```typescript
// ====== 方案 A: 普通 async/await ======
async function run(message: string): Promise<FinalResult> {
  // 问题：调用者必须等到整个循环结束才能拿到结果
  // 期间无法展示中间状态，用户看到的是一片空白
  const messages = [{ role: "user", content: message }];
  while (true) {
    const response = await callAPI(messages);
    if (response.stop_reason === "end_turn") {
      return response;  // 可能是 30 秒后才返回
    }
    // 执行工具...
  }
}

// ====== 方案 B: 回调函数 ======
async function run(message: string, callbacks: {
  onText: (text: string) => void;
  onToolStart: (name: string) => void;
  onToolEnd: (result: string) => void;
  onComplete: (result: FinalResult) => void;
}) {
  // 问题：回调地狱，控制流反转，难以组合和测试
  // 每种事件都需要单独的回调
}

// ====== 方案 C: Async Generator (Claude Code 的选择) ======
async function* run(message: string): AsyncGenerator<AgenticEvent> {
  // 优势：
  // - 调用者可以实时消费中间结果
  // - 控制流保持线性，没有回调嵌套
  // - 天然支持 for-await-of 消费
  // - 调用者可以随时 break 退出（中断支持）
  // - 可以通过 yield* 组合多个 generator

  yield { type: "text", text: "让我看看..." };
  yield { type: "tool_start", name: "Read" };
  // ...
  yield { type: "complete", result: finalResult };
}
```

### 5.2 yield 的语义：每次产出一个中间结果

```typescript
// 消费端（UI 层）
async function renderConversation() {
  const generator = conversation.run("帮我重构这个函数");

  for await (const event of generator) {
    switch (event.type) {
      case "text":
        // 实时在终端输出文字
        process.stdout.write(event.text);
        break;

      case "thinking":
        // 显示思考过程（灰色文字）
        renderThinking(event.text);
        break;

      case "tool_start":
        // 显示 spinner: "正在执行 Read..."
        startSpinner(`执行 ${event.name}...`);
        break;

      case "tool_result":
        // 停止 spinner，显示结果摘要
        stopSpinner();
        renderToolResult(event);
        break;

      case "permission_request":
        // 暂停循环，等待用户确认
        const allowed = await promptUser(`允许执行 ${event.tool}？`);
        // generator.next(allowed) 可以将结果传回 generator
        break;

      case "budget_exceeded":
        renderWarning("预算已耗尽");
        break;

      case "complete":
        renderComplete(event.result);
        break;
    }
  }
}
```

**Generator 的核心优势总结：**

| 特性 | 说明 |
|------|------|
| **惰性求值** | 不调用 `.next()` 就不会执行下一步，天然的暂停/恢复机制 |
| **双向通信** | `yield` 可以产出值，`next(value)` 可以传入值（如权限确认结果） |
| **可组合性** | `yield*` 可以委托给子 generator，便于模块化 |
| **背压控制** | 消费者处理不过来时，生产者自然暂停（不会积压） |
| **异常传播** | `generator.throw(error)` 可以向 generator 注入异常 |
| **取消支持** | `generator.return()` 可以强制结束 generator |

### 5.3 Async Generator 的执行模型

```
时间轴:
─────────────────────────────────────────────────────→

Generator (生产者):
  yield text ─── yield tool_start ─── [等待工具执行] ─── yield tool_result ─── yield text ─── return
       │              │                                        │                    │
       ▼              ▼                                        ▼                    ▼
UI (消费者):
  渲染文字       显示 spinner                              显示结果            渲染文字

                        ↑ 两者交替执行，不需要线程
```

这种模式被称为**协作式并发（cooperative concurrency）**——generator 和消费者交替执行，不需要多线程，也没有竞态条件。

---

## 6. 与 ReAct (Reasoning + Acting) 模式的对比

### 6.1 ReAct 模式简介

ReAct 是 2022 年提出的经典 Agent 范式，其核心思想是让 LLM 显式地交替进行"推理"和"行动"：

```
Thought: 我需要找到用户提到的 utils.ts 文件
Action: search_file("utils.ts")
Observation: 找到文件 /src/utils.ts，大小 2.3KB
Thought: 文件存在，我需要读取它的内容
Action: read_file("/src/utils.ts")
Observation: [文件内容...]
Thought: 我看到了 debounce 函数，它有一个 bug...
Action: edit_file("/src/utils.ts", ...)
Observation: 文件已保存
Thought: 修改完成，我应该告知用户
Action: finish("已修复 debounce 函数中的 bug")
```

### 6.2 Claude Code 中的 ReAct 对应关系

Claude Code 的 Agentic Loop 本质上是一个**隐式的 ReAct 实现**，但更加灵活：

```
┌─────────────┬──────────────────────┬────────────────────────────┐
│  ReAct 概念  │  Claude Code 对应    │  在 API 中的表现            │
├─────────────┼──────────────────────┼────────────────────────────┤
│  Thought    │  thinking block      │  { type: "thinking",       │
│  (推理)     │  (扩展思考)           │    thinking: "..." }       │
│             │                      │                            │
│  Action     │  tool_use block      │  { type: "tool_use",       │
│  (行动)     │  (工具调用)           │    name: "Bash",           │
│             │                      │    input: {...} }          │
│             │                      │                            │
│  Observation│  tool_result         │  { type: "tool_result",    │
│  (观察)     │  (工具执行结果)       │    content: "..." }        │
└─────────────┴──────────────────────┴────────────────────────────┘
```

### 6.3 执行轨迹对比

```
经典 ReAct (文本格式，需要解析):
─────────────────────────────
"Thought: I need to read the file first.\n
Action: Read[/src/main.ts]\n
Observation: [file content]\n
Thought: I see the issue...\n
Action: Edit[/src/main.ts, ...]\n
Observation: File saved.\n
Thought: Done.\n
Action: Finish[Task completed.]"

→ 需要正则解析 Thought/Action/Observation
→ 格式容易出错
→ Thought 是纯文本，无结构

Claude Code Agentic Loop (结构化 API):
─────────────────────────────
Turn 1 Response:
  content: [
    { type: "thinking", thinking: "需要先读取文件..." },
    { type: "text", text: "让我看看这个文件" },
    { type: "tool_use", name: "Read", input: { file_path: "/src/main.ts" } }
  ]
  stop_reason: "tool_use"

Tool Result:
  content: [
    { type: "tool_result", tool_use_id: "...", content: "[file content]" }
  ]

Turn 2 Response:
  content: [
    { type: "thinking", thinking: "发现了问题，需要修改第 42 行..." },
    { type: "tool_use", name: "Edit", input: { ... } }
  ]
  stop_reason: "tool_use"

→ 结构化 JSON，无需解析
→ thinking 与 action 天然分离
→ 工具调用通过 API 原生支持，不会格式出错
```

### 6.4 Claude Code 相对经典 ReAct 的进化

| 维度 | 经典 ReAct | Claude Code |
|------|-----------|-------------|
| 推理格式 | 文本中的 "Thought:" 前缀 | 独立的 thinking content block |
| 行动触发 | 文本解析 "Action:" | API 原生 tool_use |
| 观察传递 | 拼接到 prompt 文本中 | 结构化 tool_result |
| 单步多工具 | 不支持（每步一个 Action） | 支持（一次响应可包含多个 tool_use） |
| Streaming | 通常不支持 | 原生支持 |
| 权限控制 | 无 | 内置权限系统 |
| 预算控制 | 通常无 | maxTurns + maxBudgetUsd |

**Claude Code 可以一次性返回多个 tool_use block**，这意味着模型可以"并行"思考需要执行的多个操作，而不是严格的 Thought-Action-Observation 串行：

```json
// 一次响应中包含多个工具调用
{
  "content": [
    { "type": "text", "text": "我来同时读取这两个文件" },
    { "type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a.ts"} },
    { "type": "tool_use", "id": "t2", "name": "Read", "input": {"file_path": "b.ts"} }
  ],
  "stop_reason": "tool_use"
}
```

---

## 7. 伪代码示例

### 7.1 完整的 Agentic Loop 伪代码

以下伪代码展示了 Claude Code Agentic Loop 的核心逻辑，去除了错误处理和边界情况，专注于主流程：

```typescript
/**
 * Agentic Loop 核心实现伪代码
 *
 * 这段代码展示了 Claude Code 的主循环逻辑：
 * 用户发一条消息 → 循环调用 LLM + 工具 → 模型决定停止 → 返回结果
 */
class AgenticLoop {
  private messages: Message[] = [];
  private tools: ToolDefinition[];
  private systemPrompt: string;

  /**
   * 主入口：提交用户消息，启动 agentic loop
   */
  async *submitMessage(userInput: string): AsyncGenerator<Event> {
    // Step 1: 追加用户消息
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: userInput }]
    });

    // Step 2: 构建系统提示词（每次都重新构建，因为环境可能变化）
    this.systemPrompt = buildSystemPrompt({
      cwd: process.cwd(),
      platform: process.platform,
      claudeMd: readClaudeMd(),
      tools: this.tools,
    });

    // Step 3: 进入主循环
    yield* this.agenticLoop();
  }

  /**
   * 核心循环 —— Agent 的灵魂
   */
  private async *agenticLoop(): AsyncGenerator<Event> {
    let turn = 0;
    const MAX_TURNS = 100;
    const MAX_BUDGET_USD = 5.0;
    let totalCostUsd = 0;

    while (turn < MAX_TURNS && totalCostUsd < MAX_BUDGET_USD) {
      turn++;

      // ======== 调用 Anthropic API (streaming) ========
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16384,
        system: this.systemPrompt,
        messages: this.messages,
        tools: this.tools,
        stream: true,
      });

      // ======== 逐 token 处理 streaming 响应 ========
      const contentBlocks: ContentBlock[] = [];
      let stopReason: string;

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            // 实时输出文字给用户看
            yield { type: "text", text: event.delta.text };
          }
          if (event.delta.type === "thinking_delta") {
            // 实时输出思考过程
            yield { type: "thinking", text: event.delta.thinking };
          }
        }
        if (event.type === "content_block_stop") {
          contentBlocks.push(event.content_block);
        }
        if (event.type === "message_stop") {
          stopReason = event.message.stop_reason;
          totalCostUsd += calculateCost(event.message.usage);
        }
      }

      // ======== 将 assistant 响应加入历史 ========
      this.messages.push({ role: "assistant", content: contentBlocks });

      // ======== 判断退出条件 ========
      if (stopReason === "end_turn") {
        // 模型认为任务完成，退出循环
        yield { type: "complete" };
        return;
      }

      // ======== 处理工具调用 ========
      if (stopReason === "tool_use") {
        const toolUseBlocks = contentBlocks.filter(b => b.type === "tool_use");
        const toolResults: ToolResult[] = [];

        for (const toolUse of toolUseBlocks) {
          // ---- 权限检查 ----
          const permitted = await checkPermission(toolUse.name, toolUse.input);
          if (!permitted) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "User denied permission",
              is_error: true,
            });
            continue;
          }

          // ---- 执行工具 ----
          yield { type: "tool_executing", tool: toolUse.name };

          let result: string;
          try {
            result = await executeToolFunction(toolUse.name, toolUse.input);
          } catch (error) {
            result = `Error: ${error.message}`;
          }

          yield { type: "tool_done", tool: toolUse.name, output: result };

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        // ---- 将工具结果追加到消息历史 ----
        this.messages.push({ role: "user", content: toolResults });

        // 继续循环！让模型看到工具结果后决定下一步
        continue;
      }
    }

    // 超出限制，安全退出
    yield { type: "limit_reached", turn, cost: totalCostUsd };
  }
}
```

### 7.2 使用示例

```typescript
// 创建 Agentic Loop 实例
const loop = new AgenticLoop();
loop.registerTools([BashTool, ReadTool, WriteTool, EditTool, GlobTool, GrepTool]);

// 消费 generator 事件
async function main() {
  const events = loop.submitMessage("帮我在项目中找到所有未使用的导入并删除它们");

  for await (const event of events) {
    switch (event.type) {
      case "text":
        process.stdout.write(event.text);
        break;
      case "thinking":
        console.log(chalk.gray(`[thinking] ${event.text}`));
        break;
      case "tool_executing":
        console.log(chalk.yellow(`\n> 执行工具: ${event.tool}`));
        break;
      case "tool_done":
        console.log(chalk.green(`> 工具完成: ${event.tool}`));
        break;
      case "complete":
        console.log(chalk.blue("\n[任务完成]"));
        break;
      case "limit_reached":
        console.log(chalk.red(`\n[达到限制] 轮次: ${event.turn}, 花费: $${event.cost}`));
        break;
    }
  }
}
```

### 7.3 一次完整执行的时序图

```
用户输入: "帮我修复 main.ts 第 42 行的 bug"

时间 ──────────────────────────────────────────────────────────────────────→

Client (Claude Code)              Anthropic API                Tools
│                                       │                         │
│──── messages + tools ────────────────→│                         │
│                                       │ (streaming response)    │
│←── thinking: "需要先读取文件..."  ──────│                         │
│←── text: "让我看看这个文件"  ──────────│                         │
│←── tool_use: Read(main.ts)  ──────────│                         │
│←── stop_reason: tool_use  ────────────│                         │
│                                       │                         │
│                                       │                         │
│──── executeTool("Read", ...) ────────────────────────────────→ │
│←── tool_result: "[文件内容...]" ──────────────────────────────│
│                                       │                         │
│                                       │                         │
│──── messages (含 tool_result) ───────→│                         │
│                                       │ (streaming response)    │
│←── thinking: "第42行有空指针问题" ─────│                         │
│←── tool_use: Edit(main.ts, ...) ──────│                         │
│←── stop_reason: tool_use  ────────────│                         │
│                                       │                         │
│                                       │                         │
│──── executeTool("Edit", ...) ────────────────────────────────→ │
│←── tool_result: "文件已修改" ─────────────────────────────────│
│                                       │                         │
│                                       │                         │
│──── messages (含 tool_result) ───────→│                         │
│                                       │ (streaming response)    │
│←── text: "已修复！问题是..." ──────────│                         │
│←── stop_reason: end_turn ─────────────│                         │
│                                       │                         │
│ [循环结束，返回结果给用户]               │                         │

总计: 3 轮 API 调用, 2 次工具执行
```

---

## 总结

Agentic Loop 是 Claude Code 的心脏。它的设计精髓在于：

1. **模型即控制流**：不是开发者编排步骤，而是让 LLM 作为决策引擎自主编排
2. **Streaming + Async Generator**：兼顾实时反馈和代码可维护性
3. **安全约束内置**：权限系统、预算控制、轮次限制确保 Agent 可控
4. **ReAct 的工程化实践**：将学术界的 Thought-Action-Observation 范式落地为可用的产品

理解 Agentic Loop 后，你会发现 Claude Code 的其他模块（工具系统、权限系统、UI 层）都是围绕这个循环构建的"配角"。**循环本身才是主角。**
