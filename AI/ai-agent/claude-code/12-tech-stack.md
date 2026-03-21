# 12. 技术栈总结与数据流

## 目录
- [Part 1: 技术栈详解](#part-1-技术栈详解)
- [Part 2: 完整数据流](#part-2-完整数据流)
- [Part 3: 关键设计模式](#part-3-关键设计模式)
- [Part 4: 性能优化策略](#part-4-性能优化策略)
- [Part 5: 架构启示](#part-5-架构启示)

---

## Part 1: 技术栈详解

### 总览表

| 层次 | 技术 | 版本/规格 | 选型原因 |
|------|------|-----------|----------|
| 运行时 | Node.js 18+ (ESM) | ESM 模块系统 | 跨平台、生态丰富、异步 I/O |
| CLI 框架 | Commander.js | - | 轻量、声明式、社区成熟 |
| 终端 UI | Ink (React for CLI) | React 18 | 组件化、声明式、Hooks 支持 |
| 状态管理 | 类 Zustand 模式 | getState/setState | 轻量、无样板代码、可预测 |
| API 通信 | Anthropic Messages API | Streaming SSE | 流式输出、低延迟体验 |
| 搜索引擎 | ripgrep | vendor binary | 极致性能、跨平台 |
| 语法解析 | tree-sitter-bash | WASM binary | 安全解析 Bash 命令 |
| 协议扩展 | MCP | JSON-RPC 2.0 | 标准化工具接入 |
| 构建打包 | esbuild | 单文件 bundle | 极速打包（Go 实现） |
| Schema 验证 | Zod | - | 类型安全的运行时验证 |
| 图片处理 | Sharp | 可选依赖 | 高性能图片处理 |

### 逐项详解

#### 1. Node.js 18+ (ESM)

**为什么选 Node.js？**

```
选型对比：
┌─────────────┬───────────┬────────────┬───────────┬──────────────┐
│    维度      │  Node.js  │   Python   │   Rust    │    Deno      │
├─────────────┼───────────┼────────────┼───────────┼──────────────┤
│ 跨平台      │ ★★★★★    │ ★★★★☆     │ ★★★★☆    │ ★★★★☆       │
│ 生态(CLI)   │ ★★★★★    │ ★★★☆☆     │ ★★☆☆☆    │ ★★★☆☆       │
│ 异步 I/O    │ ★★★★★    │ ★★★☆☆     │ ★★★★★    │ ★★★★★       │
│ 启动速度    │ ★★★★☆    │ ★★☆☆☆     │ ★★★★★    │ ★★★★☆       │
│ 终端 UI 生态│ ★★★★★    │ ★★★☆☆     │ ★☆☆☆☆    │ ★★☆☆☆       │
│ 打包分发    │ ★★★★☆    │ ★★☆☆☆     │ ★★★★★    │ ★★★★☆       │
└─────────────┴───────────┴────────────┴───────────┴──────────────┘
```

Node.js 的核心优势：
- **事件循环 + 异步 I/O**：Agent 需要大量并发操作（API 调用、文件读写、进程管理），Node.js 的事件循环天然适合
- **NPM 生态**：Commander.js、Ink、Zod 等成熟的 CLI 工具链
- **ESM 模块系统**：现代化的模块管理，支持 Tree Shaking
- **跨平台**：Windows、macOS、Linux 一套代码

**为什么用 ESM 而不是 CJS？**
- ESM 是 JavaScript 模块的未来标准
- 支持 `top-level await`，对异步初始化友好
- 支持 Tree Shaking，减小 bundle 体积
- 更好的静态分析能力

#### 2. Commander.js — CLI 框架

```
CLI 框架对比：
┌──────────────┬──────────────┬───────────────┬──────────────┐
│    特性      │ Commander.js │    yargs      │   oclif      │
├──────────────┼──────────────┼───────────────┼──────────────┤
│ 包体积       │ ~52KB        │ ~310KB        │ ~2MB+        │
│ API 风格     │ 链式声明     │ 链式/声明式    │ 类继承       │
│ 子命令       │ ✅           │ ✅            │ ✅           │
│ 自动帮助     │ ✅           │ ✅            │ ✅           │
│ TypeScript   │ ✅ 类型声明  │ ✅ 内置       │ ✅ 原生      │
│ 插件系统     │ ❌           │ ❌            │ ✅           │
│ 学习曲线     │ 低           │ 中            │ 高           │
│ 代表项目     │ Vue CLI      │ webpack CLI   │ Heroku CLI   │
└──────────────┴──────────────┴───────────────┴──────────────┘
```

Commander.js 胜出原因：**轻量 + 够用**。Claude Code 不需要复杂的插件系统（用 MCP 替代），Commander.js 的声明式 API 足以处理所有参数解析需求。

#### 3. Ink — React for CLI

**为什么用 React 渲染终端？**

传统终端 UI 的问题：
```javascript
// 传统方式：命令式操作，手动管理光标和重绘
process.stdout.write('\033[2J');      // 清屏
process.stdout.write('\033[0;0H');    // 移动光标
process.stdout.write('Loading...');    // 写入内容
// 状态变化时需要手动重新定位、清除、重写
```

Ink 的解决方案：
```jsx
// 声明式：描述"应该是什么"，框架处理重绘
const App = () => {
  const [status, setStatus] = useState('loading');
  return (
    <Box flexDirection="column">
      <Text color="green">Status: {status}</Text>
      <Spinner />
    </Box>
  );
};
```

核心优势：
- **组件化**：工具确认框、进度条、代码块都是独立组件
- **状态管理**：useState/useEffect 处理复杂 UI 状态
- **Flexbox 布局**：终端中也能用 Flexbox 排版
- **虚拟渲染**：React 的 diff 算法最小化终端重绘

#### 4. 类 Zustand 状态管理

```
状态管理方案对比：
┌──────────┬──────────┬─────────────┬───────────┐
│   方案   │  Redux   │   Zustand   │  MobX     │
├──────────┼──────────┼─────────────┼───────────┤
│ 样板代码 │ 多       │ 极少        │ 少        │
│ 包体积   │ ~7KB     │ ~1KB        │ ~15KB     │
│ 学习曲线 │ 高       │ 低          │ 中        │
│ 不可变性 │ 强制     │ 可选        │ 可变      │
│ DevTools │ ✅       │ ✅          │ ✅        │
│ 中间件   │ ✅       │ ✅          │ ❌        │
└──────────┴──────────┴─────────────┴───────────┘
```

Claude Code 选择类 Zustand 的 `getState/setState` 模式：
```javascript
// 极简的状态管理
const store = {
  state: { messages: [], tools: [], session: null },
  getState() { return this.state; },
  setState(partial) {
    this.state = { ...this.state, ...partial };
  }
};
```

原因：CLI 应用不需要 Redux 那样的复杂状态管理。Agent 的状态相对线性（消息列表 + 会话状态），getState/setState 足够。

#### 5. Anthropic Messages API (Streaming)

**为什么必须用 Streaming？**

```
非 Streaming：
用户输入 ──────[等待 5-30 秒]──────→ 一次性返回完整结果
                 ❌ 用户体验极差

Streaming (SSE)：
用户输入 ──→ [0.3s] 第一个 token
           ──→ [0.4s] 更多 tokens...
           ──→ [0.5s] 持续输出...
           ──→ [5-30s] 完成
                 ✅ 即时反馈，用户感知延迟极低
```

Streaming 的技术实现：
- 基于 **Server-Sent Events (SSE)** 协议
- 响应类型：`message_start` → `content_block_start` → `content_block_delta`（多次）→ `content_block_stop` → `message_stop`
- 每个 delta 包含增量内容（文本片段 / tool_use JSON 片段）

对 Agent 的特殊意义：
- Agent 循环中工具调用可能很耗时，streaming 让用户实时看到 LLM 的"思考"过程
- `tool_use` 的参数也是 streaming 的，可以提前开始验证

#### 6. ripgrep — 高性能搜索

**为什么不用 Node.js 原生实现？**

```
性能对比（搜索 Linux 内核源码约 65,000 个文件）：
┌──────────────┬──────────┬───────────────────────┐
│    工具      │   耗时   │        说明            │
├──────────────┼──────────┼───────────────────────┤
│ ripgrep      │ 0.35s    │ Rust 实现，SIMD 加速  │
│ grep -r      │ 3.2s     │ 系统自带              │
│ node glob+fs │ 12.5s    │ JS 原生实现           │
│ ag           │ 1.1s     │ Silver Searcher       │
└──────────────┴──────────┴───────────────────────┘
```

ripgrep 的技术优势：
- **Rust 编写**：零成本抽象、无 GC 停顿
- **SIMD 加速**：利用 CPU 向量指令加速字符串匹配
- **智能过滤**：自动忽略 `.gitignore` 中的文件
- **Unicode 支持**：正确处理多字节编码
- **内存映射**：使用 mmap 减少系统调用

Claude Code 的做法是将 ripgrep 作为 **vendor binary** 随包分发，避免用户额外安装。

#### 7. tree-sitter-bash — 安全解析

为什么需要解析 Bash 命令？

```
安全问题示例：
LLM 可能生成：rm -rf /          # 灾难性命令
LLM 可能生成：curl ... | bash    # 注入风险
LLM 可能生成：$(whoami)          # 命令注入

tree-sitter-bash 的作用：
1. 将命令解析为 AST（抽象语法树）
2. 在 AST 层面检查危险模式
3. 比正则匹配更可靠（不会被转义字符绕过）
```

```
bash 命令: "echo hello && rm -rf /"

AST 解析结果:
program
├── command
│   ├── name: "echo"
│   └── argument: "hello"
└── command           ← 可在此层级检测到 rm -rf
    ├── name: "rm"
    ├── option: "-rf"
    └── argument: "/"
```

#### 8. esbuild

**为什么选 esbuild？**

```
构建工具对比：
┌──────────┬──────────┬──────────┬──────────┐
│   特性   │ esbuild  │ webpack  │ Rollup   │
├──────────┼──────────┼──────────┼──────────┤
│ 构建速度 │ ★★★★★   │ ★★☆☆☆   │ ★★★☆☆   │
│ 配置简洁 │ ★★★★☆   │ ★★☆☆☆   │ ★★★☆☆   │
│ 单文件输出│ ★★★★☆   │ ★★★★☆   │ ★★★★★   │
│ Node 兼容│ ★★★★★   │ ★★★★★   │ ★★★★☆   │
│ 生态成熟 │ ★★★★☆   │ ★★★★★   │ ★★★★☆   │
└──────────┴──────────┴──────────┴──────────┘
```

esbuild 的优势：
- **极速**：Go 语言实现，构建速度快于 webpack 10-100x
- **简洁 API**：一条命令即可生成 bundle
- **单文件输出**：将整个项目打包为一个 `cli.js`，简化分发
- **原生 ESM 支持**：无需额外配置即可处理 ESM 模块
- **生态成熟**：被 Vite、tsup 等工具广泛采用

#### 9. Zod — Schema 验证

```typescript
// Zod 的核心价值：运行时类型安全
import { z } from 'zod';

// 定义工具输入 Schema
const BashInputSchema = z.object({
  command: z.string().describe('要执行的 shell 命令'),
  timeout: z.number().optional().describe('超时时间(ms)'),
  background: z.boolean().optional().default(false)
});

// 自动验证 LLM 返回的工具参数
const result = BashInputSchema.safeParse(llmToolInput);
if (!result.success) {
  // LLM 给出了无效参数，返回错误让它重试
  return { error: result.error.format() };
}
```

为什么选 Zod？
- **TypeScript 优先**：自动推断类型，无需重复定义
- **运行时验证**：LLM 输出是运行时数据，编译期类型检查不够
- **错误消息友好**：可以反馈给 LLM 帮助它修正参数
- **JSON Schema 互转**：工具定义需要 JSON Schema 发给 API，Zod 可直接转换

---

## Part 2: 完整数据流

### 宏观数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户层                                  │
│  ┌──────────┐     ┌──────────┐     ┌────────────┐              │
│  │ 终端输入  │     │  管道输入  │     │  SDK 调用   │            │
│  │ (stdin)   │     │  (pipe)   │     │  (API)     │             │
│  └────┬─────┘     └────┬─────┘     └─────┬──────┘              │
│       └────────────────┼─────────────────┘                      │
│                        ▼                                        │
├─────────────────────────────────────────────────────────────────┤
│                      CLI 解析层                                  │
│  ┌──────────────────────────────────────────┐                   │
│  │           Commander.js                    │                  │
│  │  解析命令行参数、子命令路由               │                   │
│  │  --resume / --continue / --print / ...    │                  │
│  └───────────────────┬──────────────────────┘                   │
│                      ▼                                          │
├─────────────────────────────────────────────────────────────────┤
│                     初始化层                                     │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐              │
│  │ 配置加载    │  │ 权限初始化  │  │  MCP 连接    │             │
│  │ (AE_)      │  │ (Zs1)      │  │  (stdio/SSE) │             │
│  └──────┬─────┘  └──────┬─────┘  └──────┬───────┘             │
│         └───────────────┼───────────────┘                       │
│                         ▼                                       │
├─────────────────────────────────────────────────────────────────┤
│                   Agentic Loop 层（核心）                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   消息循环                               │   │
│  │                                                         │   │
│  │  ① 构建 System Prompt（5 层）                           │   │
│  │       ↓                                                 │   │
│  │  ② 组装 Messages 数组（历史 + 新输入）                  │   │
│  │       ↓                                                 │   │
│  │  ③ 注册可用工具列表（内置 + MCP）                       │   │
│  │       ↓                                                 │   │
│  │  ④ ──→ Anthropic Messages API (Streaming) ──→           │   │
│  │       ↓                                                 │   │
│  │  ⑤ 解析响应流:                                          │   │
│  │     ┌─ text        → 累积输出给用户                     │   │
│  │     ├─ thinking    → 内部推理（可选展示）               │   │
│  │     └─ tool_use    → 进入工具执行 ──┐                   │   │
│  │                                      │                  │   │
│  │  ⑥ 工具执行:                        │                   │   │
│  │     权限检查 → 执行工具 → tool_result                   │   │
│  │       ↓                                                 │   │
│  │  ⑦ tool_result 加入 Messages → 回到 ④                  │   │
│  │       ↓                                                 │   │
│  │  ⑧ end_turn / max_turns → 退出循环                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ▼                                       │
├─────────────────────────────────────────────────────────────────┤
│                      工具执行层                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐   │
│  │ Bash │ │ Read │ │Write │ │ Edit │ │ Glob │ │   Grep   │   │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘   │
│  ┌──────┐ ┌──────────┐ ┌───────────┐ ┌─────────────────┐     │
│  │Agent │ │ WebFetch │ │ WebSearch │ │   MCP Tools     │      │
│  └──────┘ └──────────┘ └───────────┘ └─────────────────┘      │
│                         ▼                                       │
├─────────────────────────────────────────────────────────────────┤
│                       输出层                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │  TUI 渲染      │  │  JSON 输出     │  │  Stream JSON     │  │
│  │  (Ink/React)   │  │  (Headless)    │  │  (SDK Mode)      │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 单次工具调用的详细数据流

```
LLM 返回 tool_use
    │
    ▼
┌─────────────────┐
│  解析 tool_use  │ ← 从 streaming delta 累积完整 JSON
│  {              │
│    name: "Bash",│
│    input: {...} │
│  }              │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Zod 验证输入   │ ← 检查参数是否符合 JSON Schema
└────────┬────────┘
         ▼
┌─────────────────┐
│  权限检查       │
│  canUseTool()   │
│  ├─ 白名单?     │ → 直接放行
│  ├─ 黑名单?     │ → 直接拒绝
│  ├─ 模式判断    │
│  └─ 用户确认?   │ → 弹出 UI
└────────┬────────┘
         ▼
┌─────────────────┐
│  Hooks: pre-tool│ ← 执行前置 hooks
└────────┬────────┘
         ▼
┌─────────────────┐
│  执行工具       │
│  tool.execute() │ ← 实际操作（读文件/执行命令/...）
└────────┬────────┘
         ▼
┌─────────────────┐
│  Hooks: post-tool│← 执行后置 hooks
└────────┬────────┘
         ▼
┌─────────────────┐
│  构造 tool_result│
│  {              │
│    role: "user",│
│    content: [{  │
│      type:      │
│  "tool_result", │
│      tool_use_id│
│      content:.. │
│    }]           │
│  }              │
└────────┬────────┘
         ▼
    加入 Messages
    继续循环 →
```

### API 请求/响应格式

```javascript
// 发送给 Anthropic API 的请求
{
  model: "claude-sonnet-4-20250514",
  max_tokens: 8192,
  system: [                          // 多层 system prompt
    { type: "text", text: "核心指令..." },
    { type: "text", text: "CLAUDE.md 内容..." },
    { type: "text", text: "Git 状态..." }
  ],
  messages: [                        // 对话历史
    { role: "user", content: "请修复这个 bug" },
    { role: "assistant", content: [
      { type: "text", text: "我来看看代码..." },
      { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "..." } }
    ]},
    { role: "user", content: [       // tool_result 以 user 角色发送
      { type: "tool_result", tool_use_id: "toolu_1", content: "文件内容..." }
    ]},
    { role: "assistant", content: "问题找到了..." }
  ],
  tools: [                           // 可用工具定义
    {
      name: "Bash",
      description: "执行 shell 命令",
      input_schema: { type: "object", properties: { command: { type: "string" } } }
    },
    // ... 更多工具
  ],
  stream: true                       // 启用 streaming
}
```

---

## Part 3: 关键设计模式

### 1. Async Generator Pattern（异步生成器模式）

```javascript
// Agentic Loop 的核心：async generator
async function* agenticLoop(messages, tools) {
  while (true) {
    // 调用 LLM API
    const stream = await callAnthropicAPI(messages, tools);

    // 逐步产出 streaming 结果
    for await (const event of stream) {
      yield event;  // 每个 token/event 都 yield 给消费者
    }

    // 检查是否有工具调用
    const toolCalls = extractToolCalls(stream);
    if (toolCalls.length === 0) break;  // 无工具调用 = 完成

    // 执行工具并将结果加入消息
    for (const call of toolCalls) {
      const result = await executeTool(call);
      messages.push(result);
      yield { type: 'tool_result', result };
    }
    // 继续循环，让 LLM 看到工具结果
  }
}
```

**为什么用 Async Generator？**
- **惰性求值**：只在消费者需要时才生成下一个值
- **背压控制**：消费者处理不过来时自动暂停生产
- **双向通信**：可以通过 `generator.next(value)` 向生成器传值
- **取消支持**：`generator.return()` 可以提前终止循环

### 2. Event-Driven Architecture（事件驱动架构）

```
┌────────────┐     Events      ┌────────────┐
│  Streaming  │ ──────────────→ │   UI 层    │
│  API 响应   │   text_delta    │  (Ink)     │
│            │   tool_use      │            │
│            │   thinking      │            │
└────────────┘                 └────────────┘
      │
      │  tool_use event
      ▼
┌────────────┐     Events      ┌────────────┐
│  权限系统   │ ──────────────→ │  用户确认   │
│            │  permission_req  │  (TUI)     │
└────────────┘                 └────────────┘
```

整个系统是事件驱动的：
- API 响应是事件流（SSE）
- 工具调用触发权限事件
- 用户输入是事件
- Hooks 是事件监听器

### 3. Middleware Pattern（中间件模式）

权限系统采用类似 Express/Koa 的中间件模式：

```javascript
// 权限检查的中间件链
const permissionChain = [
  checkWhitelist,      // 白名单 → 放行
  checkBlacklist,      // 黑名单 → 拒绝
  checkPermissionMode, // 模式判断
  askUserConfirmation  // 最终确认
];

async function canUseTool(tool, input) {
  for (const middleware of permissionChain) {
    const result = await middleware(tool, input);
    if (result !== 'continue') return result;
  }
  return 'deny'; // 默认拒绝
}
```

### 4. Layered System Prompt（分层提示词模式）

```
优先级从高到低：
┌─────────────────────────────────┐
│  Layer 5: 动态附加              │ ← 运行时生成
│  (Memory, Skills, MCP)          │
├─────────────────────────────────┤
│  Layer 4: 自定义追加            │ ← 临时注入
│  (--append-system-prompt)       │
├─────────────────────────────────┤
│  Layer 3: 系统上下文            │ ← 自动收集
│  (Git, OS, Date)                │
├─────────────────────────────────┤
│  Layer 2: 用户上下文            │ ← 项目配置
│  (CLAUDE.md)                    │
├─────────────────────────────────┤
│  Layer 1: 核心指令              │ ← 不可变
│  (安全规则, 工具指南)           │
└─────────────────────────────────┘
```

这种分层设计的好处：
- **关注点分离**：每层负责不同类型的上下文
- **可覆盖性**：高层可以覆盖低层的行为（在安全范围内）
- **可扩展性**：新增上下文只需添加新层
- **Token 管理**：可以按层进行截断和优先级排序

### 5. Nested Agent Pattern（嵌套 Agent 模式）

```
Main Agent (Sonnet，默认模型)
  ├── Sub-Agent: Explore (Haiku)     ← 快速搜索（使用廉价模型）
  ├── Sub-Agent: Plan (Sonnet)       ← 设计方案
  ├── Sub-Agent: General (Sonnet)    ← 执行子任务
  │     └── Sub-Sub-Agent: ...       ← 可继续嵌套
  └── Sub-Agent: Custom (配置)       ← 自定义角色（可通过 --model 覆盖）
```

每个子 Agent 是完整的 Claude Code 实例，拥有：
- 独立的 Agentic Loop
- 独立的工具集（可能受限）
- 独立的 System Prompt
- 可选的 Git Worktree 隔离

### 6. Context Compression Pattern（上下文压缩模式）

```
Messages 增长:
[msg1][msg2][msg3]...[msg_n] → 接近 context limit

压缩触发:
[msg1][msg2]...[msg_k] → [SUMMARY] [msg_k+1]...[msg_n]
       压缩为摘要 ↑          保留最近消息 ↑

compact_boundary 标记:
[...old messages...][compact_boundary][...new messages...]
                          ↑
                   压缩分界线
```

---

## Part 4: 性能优化策略

### 1. Streaming 减少首字延迟 (Time-to-First-Token)

```
传统模式延迟:
请求 ────────────[5-30s 等待]────────────→ 完整响应
TTFT = 5-30s  ❌

Streaming 模式延迟:
请求 ──[300ms]→ 第一个 token ──→ 持续输出 ──→ 完成
TTFT = 300ms  ✅

用户感知:
- 传统模式: "好慢，是不是卡住了？"
- Streaming:  "它在思考...已经开始写了..."
```

### 2. 并行预加载 (Parallel Prefetch)

```
串行加载（❌ 慢）:
auth ──→ config ──→ git ──→ mcp ──→ ready
[1s]     [0.5s]    [0.3s]  [1s]    = 2.8s

并行加载（✅ 快）:
auth ────→ ┐
config ──→ │
git ─────→ ├→ ready
mcp ──────→┘
[~1s]                               = ~1s
```

启动时使用 `Promise.all` 或 `Promise.allSettled` 并行加载所有启动依赖（认证、配置、git 状态、MCP 连接），将启动时间减少约 60%。

### 3. ripgrep 替代原生搜索

| 场景 | Node.js fs.readdir + match | ripgrep |
|------|---------------------------|---------|
| 搜索 10,000 个文件 | ~3.5s | ~0.08s |
| 大文件搜索 (1GB) | 内存溢出风险 | ~0.5s |
| .gitignore 处理 | 需手动实现 | 内置 |
| 正则性能 | V8 正则引擎 | Rust regex (SIMD) |

关键：搜索是 Agent 最频繁的操作之一（Grep、Glob），用原生 Rust 二进制直接提升一个数量级。

### 4. 单文件 Bundle 减少启动开销

```
传统 Node.js 项目:
node_modules/  (数百 MB)
├── 依赖 A/
│   └── node_modules/
│       └── 依赖 B/...
启动时: 递归解析依赖 → 大量文件 I/O → 慢

单文件 Bundle:
cli.js  (~15600 行, ~2MB)
启动时: 加载一个文件 → 直接执行 → 快
```

esbuild 将所有代码（包括依赖）打包为单个 ESM 文件：
- 消除模块解析开销
- 减少文件 I/O
- 简化分发（npm install 后只需要 cli.js + vendor binaries）

### 5. Prompt Caching 减少重复处理

```
Agentic Loop 每轮都发送完整消息（system + history + new）:

没有缓存:
  Turn 1: 处理 [System 5K] + [新消息 1K] = 6K tokens  ($$$)
  Turn 2: 处理 [System 5K] + [历史 3K] + [新消息 2K] = 10K tokens  ($$$)
  Turn 3: 处理 [System 5K] + [历史 8K] + [新消息 2K] = 15K tokens  ($$$)

有缓存:
  Turn 1: 处理 [System 5K 创建缓存] + [新消息 1K] = 6K tokens
  Turn 2: [System 5K 缓存命中 0.1x] + [历史 3K] + [新消息 2K]
          实际成本: 0.5K + 3K + 2K = 5.5K tokens  (省 45%)
  Turn 3: [System+历史 8K 缓存命中 0.1x] + [新消息 2K]
          实际成本: 0.8K + 2K = 2.8K tokens  (省 81%)
```

Anthropic 的 Prompt Caching 是 Agentic Loop 最重要的成本优化之一：
- 缓存命中时输入 token 价格仅为 0.1x
- System prompt + 早期消息历史是稳定前缀，天然适合缓存
- 缓存 TTL 5 分钟，活跃对话自动续期

### 6. 子 Agent 模型降级

```
成本-性能矩阵:
┌────────────────┬──────────┬──────────┬───────────┐
│     任务       │   模型   │ 成本/1M  │  速度     │
├────────────────┼──────────┼──────────┼───────────┤
│ 复杂推理/编码  │  Opus    │  $$$     │  较慢     │
│ 常规编码任务   │  Sonnet  │  $$      │  中等     │
│ 代码搜索/探索  │  Haiku   │  $       │  快       │
│ 简单分类判断   │  Haiku   │  $       │  快       │
└────────────────┴──────────┴──────────┴───────────┘

实际效果：
主 Agent (Sonnet) 调度 3 个 Explore 子 Agent (Haiku) 并行搜索
总成本 ≈ 1 次 Sonnet 调用 + 3 次 Haiku 调用
      ≈ $0.003 + 3 × $0.001 = $0.006
对比: 3 次 Sonnet 搜索 = 3 × $0.003 = $0.009 (贵 1.5 倍)
```

---

## Part 5: 架构启示

### 对构建 AI Agent 系统的关键教训

#### 1. Agent Loop 是核心，一切围绕它构建

```
不要这样想 Agent:
"LLM + 工具 = Agent"

要这样想:
"while (未完成) { 思考 → 选择工具 → 执行 → 观察 } = Agent"
```

Agent 的本质不是 LLM 加工具，而是一个**决策循环**。LLM 是循环中的决策引擎，工具是循环中的执行器。没有循环，就只是一个聊天机器人。

#### 2. 工具系统需要精心设计

好的工具设计原则：
- **最小化**：每个工具做一件事（Unix 哲学）
- **正交性**：工具之间不重叠（Read vs Edit vs Write 各有分工）
- **安全性**：输入验证 + 权限检查
- **可组合性**：工具可以串联使用
- **描述性**：清晰的描述让 LLM 知道何时使用

```
好的工具设计:
Edit(file, old_string, new_string)  ← 精确、安全、可验证

坏的工具设计:
ModifyFile(file, instructions)  ← 模糊、不可验证、容易出错
```

#### 3. 权限系统不可忽视

```
没有权限系统:
LLM 说 "rm -rf /" → Agent 执行 → 灾难

有权限系统:
LLM 说 "rm -rf /" → 权限检查 → 用户确认 → 用户拒绝 → 安全
```

AI Agent 的安全模型应该是 **"默认不信任"**：
- 每个外部操作都需要授权
- 高危操作需要人工确认
- 支持白名单/黑名单细粒度控制
- 沙箱作为最后的安全防线

#### 4. 上下文管理是长期挑战

```
短对话 (< 50K tokens): 一切正常
中等对话 (50K - 150K): 开始感到压力
长对话 (> 150K tokens): 必须压缩，信息丢失

Claude Code 的解决方案:
- 摘要压缩（保留关键信息）
- Auto Memory（跨会话记忆）
- 分层 System Prompt（结构化上下文）
```

这是一个尚未完美解决的问题。随着 context window 增大（200K → 1M → ...），问题会缓解但不会消失。

#### 5. 可扩展性（MCP/插件）是关键

```
封闭系统:
Agent ── 内置工具 1, 2, 3
         无法扩展 ❌

开放系统 (Claude Code):
Agent ── 内置工具
      ── MCP 工具（标准协议）
      ── MCP 社区生态（第三方 MCP Server）
      ── Hooks（Shell 脚本）
      ── 自定义 Agent
         无限扩展 ✅
```

MCP 的设计启示：**不要自己定义私有协议，拥抱标准**。就像 USB 统一了外设接口，MCP 正在统一 AI 工具接口。

### 总结：Claude Code 架构的精髓

```
┌────────────────────────────────────────────────────┐
│                  Claude Code 设计哲学                │
│                                                    │
│  1. Loop over Chat     循环优于对话                 │
│  2. Tools over Text    工具优于文本                 │
│  3. Safety by Default  安全即默认                   │
│  4. Stream over Batch  流式优于批处理               │
│  5. Open over Closed   开放优于封闭                 │
│  6. Simple over Complex 简单优于复杂               │
│                                                    │
│  这不仅是一个 CLI 工具，                            │
│  而是 AI Agent 架构设计的参考实现。                  │
└────────────────────────────────────────────────────┘
```

---

> 下一步学习建议：
> - 动手实现一个最小化的 Agent Loop（参考 [03-agentic-loop.md](./03-agentic-loop.md)）
> - 尝试开发一个 MCP Server（参考 [09-mcp-integration.md](./09-mcp-integration.md)）
> - 阅读 Anthropic 的 [Tool Use 文档](https://docs.anthropic.com/en/docs/tool-use) 理解 Function Calling
> - 研究项目中的 `AI/mini-openclaw/` 实现，对比 Claude Code 的架构设计
