# 07 - UI Layer（用户界面层）

## 概述

UI 层是 AI Agent 与用户之间的桥梁。一个优秀的 Agent 不仅需要强大的推理能力，还需要良好的交互体验。本节深入探讨 CLI 场景下的 UI 技术选型、运行模式设计、输出格式以及流式输出的用户体验设计。

---

## 1. Terminal UI 的技术选型

### 1.1 Ink：React for CLI 的设计理念

[Ink](https://github.com/vadimdemedes/ink) 是一个基于 React 的终端 UI 框架，核心理念是：**用 React 的方式来构建命令行界面**。

```
传统 CLI 输出:
  process.stdout.write("Loading...\n")
  process.stdout.write("Done!\n")

Ink 的方式:
  <Box flexDirection="column">
    <Text color="green">Loading...</Text>
    <Spinner type="dots" />
  </Box>
```

Ink 将终端抽象为一个"渲染目标"（类似浏览器 DOM），React 的虚拟 DOM 机制通过自定义 Reconciler 将组件树渲染到终端字符画布上。

### 1.2 为什么用 React 来渲染终端？

传统 CLI 工具（如直接使用 `console.log`、`readline`）在面对复杂交互时会遇到大量问题：状态管理混乱、UI 更新困难、代码耦合严重。React 的引入解决了这些痛点：

**组件化**

```jsx
// 将 UI 拆分为独立、可复用的组件
function ToolCallCard({ toolName, args, status }) {
  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column">
      <Text bold>{toolName}</Text>
      <Text dimColor>{JSON.stringify(args, null, 2)}</Text>
      <StatusBadge status={status} />
    </Box>
  );
}

function MessageList({ messages }) {
  return messages.map((msg, i) => (
    <MessageBubble key={i} role={msg.role} content={msg.content} />
  ));
}
```

组件化让复杂的 CLI 界面变得可维护——每个组件只关心自己的渲染逻辑，可以独立测试和复用。

**状态管理**

```jsx
function App() {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingTool, setPendingTool] = useState(null);

  // 状态变化自动触发重新渲染
  // 不需要手动清屏、重绘
  return (
    <Box flexDirection="column">
      <MessageList messages={messages} />
      {isStreaming && <StreamingIndicator />}
      {pendingTool && <ToolConfirmDialog tool={pendingTool} />}
      <InputBox onSubmit={handleSubmit} />
    </Box>
  );
}
```

React 的状态管理让"当数据变化时自动更新 UI"这件事变得自然——你不需要手动跟踪哪些行需要重新输出。

**声明式渲染**

```jsx
// 声明式：描述"UI 应该是什么样"
function StatusBar({ agentState }) {
  return (
    <Box>
      {agentState === 'thinking' && <Text color="yellow">Thinking...</Text>}
      {agentState === 'executing' && <Text color="blue">Executing tool...</Text>}
      {agentState === 'idle' && <Text color="green">Ready</Text>}
    </Box>
  );
}

// 对比命令式：需要手动管理每个状态转换
// if (prevState === 'thinking' && newState === 'executing') {
//   clearLine(); moveCursor(...); write("Executing tool...");
// }
```

声明式渲染的最大优势在于**消除了状态转换的复杂度**。你只需声明"在某个状态下 UI 长什么样"，框架负责计算差异并高效更新。

### 1.3 createRoot 创建 React 渲染树

Ink 提供了类似 `ReactDOM.createRoot` 的 API 来初始化终端渲染：

```jsx
import { render } from 'ink';

// 创建渲染实例，挂载到 stdout
const instance = render(<App />);

// render 返回的实例提供以下能力：
// instance.rerender(<App newProps={...} />) — 重新渲染
// instance.unmount() — 卸载组件树
// instance.waitUntilExit() — 等待退出（返回 Promise）
```

底层流程：

```
createRoot(stdout)
    |
    v
创建 Ink 渲染器（自定义 React Reconciler）
    |
    v
构建 Fiber 树（React 内部数据结构）
    |
    v
Layout 计算（基于 Yoga，Facebook 的 Flexbox 引擎）
    |
    v
将 Flexbox 布局结果转换为终端字符
    |
    v
输出到 stdout（使用 ANSI 转义序列控制颜色、光标等）
```

关键点：Ink 使用了 [Yoga](https://yogalayout.com/)（一个跨平台的 Flexbox 布局引擎），所以你可以在终端中使用 `flexDirection`、`justifyContent`、`alignItems` 等 CSS Flexbox 属性来排版。

### 1.4 FPS 监控（getFpsMetrics）

在终端 UI 中，频繁的重绘可能导致闪烁或性能问题。FPS 监控帮助开发者了解渲染性能：

```js
// FPS 监控的核心思路
function createFpsMonitor() {
  let frameCount = 0;
  let lastTime = Date.now();
  const history = [];

  function onFrame() {
    frameCount++;
    const now = Date.now();
    const elapsed = now - lastTime;

    if (elapsed >= 1000) {
      const fps = Math.round((frameCount * 1000) / elapsed);
      history.push(fps);
      frameCount = 0;
      lastTime = now;
    }
  }

  function getFpsMetrics() {
    return {
      current: history[history.length - 1] || 0,
      average: history.reduce((a, b) => a + b, 0) / history.length || 0,
      min: Math.min(...history),
      max: Math.max(...history),
    };
  }

  return { onFrame, getFpsMetrics };
}
```

典型应用场景：
- **调试模式下显示 FPS**：帮助定位渲染瓶颈
- **自适应渲染频率**：当 FPS 过低时，降低更新频率（如减少 streaming 输出的刷新率）
- **性能回归检测**：在 CI 中监控 FPS 是否低于阈值

---

## 2. 两种运行模式详解

AI Agent CLI 通常需要支持两种截然不同的使用场景：人类交互和程序调用。因此设计了两种运行模式。

### 2.1 交互式模式（Interactive Mode / TUI）

交互式模式提供完整的 TUI（Text User Interface），面向人类用户的直接使用。

#### 完整 TUI 界面结构

```
┌─────────────────────────────────────────────┐
│  Claude Code  v1.x.x          [model: ...]  │  <- 标题栏
├─────────────────────────────────────────────┤
│                                             │
│  User: 请帮我重构这个函数                      │  <- 消息历史
│                                             │
│  Assistant: 我来看看这个函数...                 │  <- 流式输出区
│  ████████░░░░ streaming...                  │
│                                             │
│  ┌─ Tool Call ─────────────────────────┐    │  <- 工具调用卡片
│  │  Read: /src/utils.js                │    │
│  │  Status: completed                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
├─────────────────────────────────────────────┤
│  > 请输入你的消息...            [Tab:补全]    │  <- 输入区
└─────────────────────────────────────────────┘
```

#### 输入编辑

交互式模式需要一个功能丰富的输入编辑器：

```jsx
function InputEditor({ onSubmit }) {
  const [input, setInput] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [history, setHistory] = useState([]);      // 历史命令
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((inputChar, key) => {
    if (key.return) {
      onSubmit(input);
      setHistory(prev => [...prev, input]);
      setInput('');
    } else if (key.upArrow) {
      // 上翻历史
      navigateHistory(-1);
    } else if (key.downArrow) {
      // 下翻历史
      navigateHistory(1);
    } else if (key.tab) {
      // 命令/路径补全
      handleTabCompletion();
    } else {
      // 常规输入
      setInput(prev => prev + inputChar);
    }
  });

  return (
    <Box>
      <Text color="cyan">{"> "}</Text>
      <Text>{input}</Text>
      <Cursor />
    </Box>
  );
}
```

支持的编辑能力：
- **多行输入**：支持 Shift+Enter 换行
- **历史回溯**：上下箭头翻阅历史命令
- **Tab 补全**：斜杠命令补全、文件路径补全
- **Ctrl+C / Ctrl+D**：中断当前操作 / 退出

#### 工具调用确认对话框

当 Agent 需要执行有副作用的操作（写文件、执行命令）时，弹出确认对话框：

```jsx
function ToolConfirmDialog({ toolCall, onConfirm, onReject }) {
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
    >
      <Text bold color="yellow">Tool Call: {toolCall.name}</Text>
      <Box marginTop={1}>
        <SyntaxHighlight language="json">
          {JSON.stringify(toolCall.args, null, 2)}
        </SyntaxHighlight>
      </Box>
      <Box marginTop={1}>
        <Text>
          Allow? <Text bold color="green">[Y]es</Text> / <Text bold color="red">[N]o</Text> / <Text bold color="blue">[A]lways</Text>
        </Text>
      </Box>
    </Box>
  );
}
```

确认策略的层次设计：
- **单次确认（Yes）**：仅允许本次调用
- **拒绝（No）**：拒绝本次调用，Agent 需要调整策略
- **始终允许（Always）**：本次会话内不再询问同类操作
- **权限白名单**：配置文件中预设允许的工具和路径

这是 Agent 安全性的关键一环——确保人类对危险操作有最终控制权。

#### 进度展示（Streaming 输出）

```jsx
function StreamingOutput({ chunks }) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    // 逐 chunk 追加显示，实现打字机效果
    if (chunks.length > 0) {
      const latest = chunks[chunks.length - 1];
      setDisplayedText(prev => prev + latest);
    }
  }, [chunks]);

  return (
    <Box flexDirection="column">
      <MarkdownRenderer text={displayedText} />
      <Box>
        <Spinner type="dots" />
        <Text dimColor> generating...</Text>
      </Box>
    </Box>
  );
}
```

#### 语法高亮（代码块渲染）

终端中的代码高亮依赖 ANSI 颜色码：

```jsx
function CodeBlock({ code, language }) {
  // 使用 highlight.js 或类似库进行词法分析
  // 然后将 token 映射为终端颜色
  const highlighted = highlightCode(code, language);

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection="column"
      paddingX={1}
    >
      <Text dimColor>{`  ${language}`}</Text>
      <Text>{highlighted}</Text>
    </Box>
  );
}

// 终端颜色映射示例
const tokenColorMap = {
  keyword:  'blue',     // function, const, return
  string:   'green',    // "hello"
  number:   'yellow',   // 42
  comment:  'gray',     // // comment
  function: 'cyan',     // myFunc()
};
```

#### 用户体验设计要点

1. **响应速度感知**：即使 LLM 还在生成，也要立即展示已有内容（streaming），让用户感到系统在"思考"而非"卡住"
2. **进度可见性**：每个阶段（思考中 -> 调用工具 -> 等待结果 -> 继续生成）都要有明确的视觉指示
3. **可中断性**：用户随时可以 Ctrl+C 中断当前操作，Agent 应优雅地处理中断
4. **信息层次**：关键信息高亮，辅助信息用淡色（dimColor），形成清晰的视觉层次
5. **终端适配**：处理不同终端宽度、颜色支持级别（truecolor / 256色 / 16色 / 无颜色）

### 2.2 Headless 模式（Non-Interactive Mode）

Headless 模式去掉所有交互式 UI，以纯文本或结构化数据输出结果，面向程序化调用。

#### 无 UI，纯 stdout 输出

```js
async function runHeadless(options) {
  const { prompt, outputFormat, tools, model } = options;

  // 没有 Ink 渲染，没有交互式输入
  // 直接将 prompt 发送给 Agent，收集结果

  const agent = createAgent({ model, tools });
  const result = await agent.run(prompt);

  // 根据输出格式写入 stdout
  switch (outputFormat) {
    case 'text':
      process.stdout.write(result.text);
      break;
    case 'json':
      process.stdout.write(JSON.stringify(result));
      break;
    case 'stream-json':
      // 流式输出每个事件
      for await (const event of agent.stream(prompt)) {
        process.stdout.write(JSON.stringify(event) + '\n');
      }
      break;
  }

  process.exit(result.exitCode);
}
```

#### 适用于管道（Pipe）操作

Headless 模式让 Agent 可以融入 Unix 管道生态：

```bash
# 将文件内容通过管道传给 Agent，结果写入新文件
cat src/legacy.js | claude-agent "重构这段代码" > src/refactored.js

# 链式调用多个处理步骤
cat data.csv | claude-agent "分析数据趋势" --format json | jq '.summary'

# 与 find、xargs 等工具组合
find . -name "*.test.js" | xargs -I {} claude-agent "审查这个测试文件: {}" --format text
```

关键设计原则：
- **stdout 只输出结果**：日志、进度等信息走 stderr
- **退出码有意义**：0=成功，1=Agent 错误，2=用户中断
- **支持 stdin 输入**：可以从管道读取输入内容

#### SDK 集成场景

Headless 模式也是 SDK 的基础：

```js
import { createAgent } from 'claude-agent';

// 在 Node.js 程序中嵌入 Agent
const agent = createAgent({
  model: 'claude-sonnet',
  tools: [readFile, writeFile, bash],
  headless: true,
});

// 编程式调用
const result = await agent.run('重构 src/utils.js 中的 formatDate 函数');
console.log(result.text);
console.log(result.toolCalls); // 查看执行了哪些工具
```

#### CI/CD 中的自动化使用

```yaml
# GitHub Actions 示例
jobs:
  code-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: AI Code Review
        run: |
          # 获取 PR 的 diff
          git diff origin/main...HEAD > /tmp/diff.txt

          # 让 Agent 审查代码变更
          claude-agent \
            --headless \
            --format json \
            --prompt "审查以下代码变更，指出潜在问题" \
            --stdin < /tmp/diff.txt \
            > /tmp/review.json

      - name: Post Review Comment
        run: |
          # 将审查结果发布为 PR 评论
          node scripts/post-review.js /tmp/review.json
```

Headless 模式在 CI/CD 中的注意事项：
- **超时控制**：设置合理的超时时间，避免 Agent 无限循环
- **成本控制**：限制最大 token 数或最大工具调用次数
- **结果校验**：对 Agent 输出进行格式校验，确保下游流程能正确消费
- **结果稳定性**：尽管可以设置温度为 0，但 LLM 输出仍可能因 GPU 浮点计算差异而不完全确定性，需要对输出做容错处理

---

## 3. 输出格式

Agent 支持三种输出格式，覆盖不同的消费场景：

### 3.1 text：纯文本

最简单的格式，直接输出 Agent 的最终文本回复。

```bash
$ claude-agent "1+1等于几" --format text
1+1 等于 2。
```

适用场景：
- 人类直接阅读
- 简单的管道组合
- 替代手工操作的一次性任务

### 3.2 json：单次 JSON 结果

整个交互完成后，输出一个完整的 JSON 对象：

```bash
$ claude-agent "读取 package.json 并告诉我版本号" --format json
```

```json
{
  "result": "当前版本号是 1.2.3",
  "messages": [
    {
      "role": "user",
      "content": "读取 package.json 并告诉我版本号"
    },
    {
      "role": "assistant",
      "content": "我来读取 package.json 文件。",
      "toolCalls": [
        {
          "name": "read_file",
          "args": { "path": "package.json" },
          "result": "{ \"name\": \"my-app\", \"version\": \"1.2.3\" }"
        }
      ]
    },
    {
      "role": "assistant",
      "content": "当前版本号是 1.2.3"
    }
  ],
  "usage": {
    "inputTokens": 1250,
    "outputTokens": 89
  },
  "exitCode": 0
}
```

适用场景：
- 程序需要解析 Agent 的完整输出
- 需要审计 Agent 执行了哪些工具调用
- 成本追踪（token 使用量）

### 3.3 stream-json：实时流式 JSON（SDK 模式）

每个事件作为独立的 JSON 行（NDJSON 格式）实时输出：

```bash
$ claude-agent "解释快速排序" --format stream-json
```

```jsonl
{"type":"start","sessionId":"abc123","timestamp":1711234567}
{"type":"text_delta","content":"快速排序"}
{"type":"text_delta","content":"（Quick Sort）是"}
{"type":"text_delta","content":"一种高效的排序算法"}
{"type":"tool_call_start","name":"read_file","args":{"path":"sort.js"}}
{"type":"tool_call_end","name":"read_file","result":"..."}
{"type":"text_delta","content":"根据代码可以看到..."}
{"type":"end","usage":{"inputTokens":500,"outputTokens":200},"exitCode":0}
```

适用场景：
- SDK 集成，需要实时感知 Agent 的每一步动作
- 构建自定义 UI（Web 前端消费这些事件来渲染）
- 实时日志分析和监控

**事件类型设计**：

| 事件类型 | 说明 | 关键字段 |
|---------|------|---------|
| `start` | 会话开始 | sessionId, timestamp |
| `text_delta` | 文本增量 | content |
| `tool_call_start` | 开始调用工具 | name, args |
| `tool_call_end` | 工具调用完成 | name, result, duration |
| `error` | 发生错误 | message, code |
| `end` | 会话结束 | usage, exitCode |

---

## 4. Ink 框架深入

### 4.1 基于 React 的组件模型

Ink 通过自定义 React Reconciler 实现了终端渲染。这意味着你可以使用几乎所有 React 特性：

```jsx
// 函数组件 + Hooks
function Timer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return <Text>Elapsed: {seconds}s</Text>;
}

// Context 跨组件共享状态
const ThemeContext = createContext({ primaryColor: 'cyan' });

function ThemedText({ children }) {
  const theme = useContext(ThemeContext);
  return <Text color={theme.primaryColor}>{children}</Text>;
}

// useReducer 管理复杂状态
function ChatApp() {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  return (
    <Box flexDirection="column">
      <MessageList messages={state.messages} />
      <InputBox onSubmit={(text) => dispatch({ type: 'SEND', text })} />
    </Box>
  );
}
```

Ink 提供的核心组件：

| 组件 | 作用 | 类比 HTML |
|------|------|----------|
| `<Box>` | 布局容器，支持 Flexbox | `<div>` |
| `<Text>` | 文本输出，支持颜色和样式 | `<span>` |
| `<Newline>` | 换行 | `<br>` |
| `<Spacer>` | 弹性空白 | `flex: 1` |
| `<Static>` | 静态输出（不会被重绘覆盖） | - |

### 4.2 终端重绘机制

Ink 的重绘过程：

```
状态变化 (setState)
    |
    v
React Reconciler 计算 Fiber 树差异
    |
    v
生成新的组件树快照
    |
    v
Yoga 引擎计算 Flexbox 布局
    |
    v
将布局结果转为字符网格 (character grid)
    |
    v
与上一帧比较，计算最小差异
    |
    v
通过 ANSI 转义序列更新终端
    ├── \x1b[H     — 移动光标到起始位置
    ├── \x1b[2K    — 清除当前行
    ├── \x1b[38;2;r;g;bm — 设置前景色
    └── 写入新内容
```

关键优化：
- **差异更新**：只重绘发生变化的行，减少闪烁
- **批量更新**：多次 setState 合并为一次重绘（React 的 batching 机制）
- **Static 组件**：已经输出的内容不参与重绘，滚出可视区域后不再管理

### 4.3 对比传统 CLI UI 库

| 特性 | Ink | blessed | inquirer | chalk + readline |
|------|-----|---------|----------|-----------------|
| **编程模型** | 声明式 (React) | 命令式 (Widget) | 问答式 (Prompt) | 过程式 |
| **组件复用** | 优秀（React 组件） | 一般（Widget 继承） | 差（整体式） | 无 |
| **状态管理** | useState/useReducer | 手动管理 | 内置有限 | 手动管理 |
| **布局系统** | Flexbox (Yoga) | 绝对/相对定位 | 无 | 无 |
| **动态更新** | 自动 (Virtual DOM) | 手动 render() | 不支持 | 手动清屏重写 |
| **React 生态** | 完全兼容 | 不兼容 | 不兼容 | 不兼容 |
| **学习曲线** | 低（会 React 即可） | 高（独有 API） | 低（简单场景） | 低 |
| **适合场景** | 复杂交互式 TUI | 全屏 TUI 应用 | 简单命令行问答 | 简单输出 |

**为什么 Ink 更适合 AI Agent CLI？**

1. **复杂且动态的 UI**：Agent 的界面包含消息列表、流式输出、工具调用卡片、确认对话框、输入编辑器等众多组件，需要强大的组件化能力
2. **频繁的状态变化**：streaming 输出、工具执行进度、用户输入等状态在不断变化，React 的自动重绘机制大大简化了代码
3. **团队协作**：前端团队普遍熟悉 React，降低了维护成本
4. **生态复用**：可以直接使用社区的 Ink 组件（Spinner、Select、TextInput 等）

### 4.4 Hooks 在终端 UI 中的应用

Ink 提供了一些终端特有的 Hooks：

```jsx
import { useInput, useApp, useStdin, useFocus } from 'ink';

function MyComponent() {
  // 监听键盘输入
  useInput((input, key) => {
    if (key.escape) {
      // 处理 Esc 键
    }
    if (input === 'q') {
      // 处理 q 键
    }
  });

  // 访问 App 实例（用于退出）
  const { exit } = useApp();

  // 访问 stdin 状态
  const { isRawModeSupported } = useStdin();

  // 焦点管理（多组件间切换焦点）
  const { isFocused } = useFocus();

  return (
    <Box borderColor={isFocused ? 'cyan' : 'gray'} borderStyle="single">
      <Text>{isFocused ? 'Focused!' : 'Not focused'}</Text>
    </Box>
  );
}
```

自定义 Hooks 封装复杂逻辑：

```jsx
// 封装 Agent 的流式输出逻辑
function useStreamingResponse(agentStream) {
  const [chunks, setChunks] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [toolCalls, setToolCalls] = useState([]);

  useEffect(() => {
    if (!agentStream) return;

    const subscription = agentStream.subscribe({
      onTextDelta: (delta) => {
        setChunks(prev => [...prev, delta]);
      },
      onToolCallStart: (tool) => {
        setToolCalls(prev => [...prev, { ...tool, status: 'running' }]);
      },
      onToolCallEnd: (toolId, result) => {
        setToolCalls(prev =>
          prev.map(t => t.id === toolId ? { ...t, status: 'done', result } : t)
        );
      },
      onComplete: () => setIsComplete(true),
    });

    return () => subscription.unsubscribe();
  }, [agentStream]);

  const fullText = chunks.join('');
  return { fullText, chunks, isComplete, toolCalls };
}
```

---

## 5. 流式输出的 UX 设计

### 5.1 打字机效果

流式输出（streaming）是 LLM 应用最重要的 UX 模式之一。用户不需要等待完整响应，可以实时看到内容生成过程。

```jsx
function TypewriterText({ stream }) {
  const [text, setText] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);

  // 消费流式数据
  useEffect(() => {
    const reader = stream.getReader();

    async function read() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          setCursorVisible(false);
          break;
        }
        setText(prev => prev + value);
      }
    }

    read();
    return () => reader.cancel();
  }, [stream]);

  // 光标闪烁效果
  useEffect(() => {
    if (!cursorVisible) return;
    const timer = setInterval(() => {
      setCursorVisible(v => !v);
    }, 530);
    return () => clearInterval(timer);
  }, [cursorVisible]);

  return (
    <Text>
      {text}
      {cursorVisible && <Text color="cyan">|</Text>}
    </Text>
  );
}
```

打字机效果的细节优化：
- **缓冲合并**：不要每收到一个字符就触发一次重绘，而是积攒一小段（如 50ms）后批量更新
- **Markdown 实时渲染**：随着文本增长，实时解析 Markdown 并渲染（代码块、列表、标题等）
- **自动滚动**：当内容超出终端高度时，自动滚动到最新内容

```jsx
// 带缓冲的流式文本组件
function BufferedStreamText({ stream, bufferMs = 50 }) {
  const [text, setText] = useState('');
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  useEffect(() => {
    stream.on('data', (chunk) => {
      bufferRef.current += chunk;

      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          setText(prev => prev + bufferRef.current);
          bufferRef.current = '';
          timerRef.current = null;
        }, bufferMs);
      }
    });
  }, [stream, bufferMs]);

  return <MarkdownRenderer text={text} />;
}
```

### 5.2 工具调用的可视化

当 Agent 调用工具时，用户需要清楚地知道正在发生什么：

```jsx
function ToolCallVisualizer({ toolCall }) {
  const { name, args, status, result, duration } = toolCall;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* 工具名称和状态 */}
      <Box>
        {status === 'running' && <Spinner type="dots" />}
        {status === 'done' && <Text color="green">{"  "}</Text>}
        {status === 'error' && <Text color="red">{"  "}</Text>}
        <Text bold> {name}</Text>
        {duration && <Text dimColor> ({duration}ms)</Text>}
      </Box>

      {/* 工具参数 */}
      <Box marginLeft={2}>
        <Text dimColor>{formatToolArgs(name, args)}</Text>
      </Box>

      {/* 工具结果（折叠/展开） */}
      {status === 'done' && result && (
        <Box marginLeft={2} marginTop={1}>
          <CollapsibleResult result={result} maxLines={5} />
        </Box>
      )}
    </Box>
  );
}

// 针对不同工具类型格式化参数显示
function formatToolArgs(toolName, args) {
  switch (toolName) {
    case 'read_file':
      return `Reading: ${args.path}`;
    case 'write_file':
      return `Writing: ${args.path} (${args.content.length} chars)`;
    case 'bash':
      return `$ ${args.command}`;
    case 'search':
      return `Searching: "${args.query}" in ${args.path || '.'}`;
    default:
      return JSON.stringify(args);
  }
}
```

进度条用于长时间运行的工具：

```jsx
function ProgressBar({ progress, width = 30 }) {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const percent = Math.round(progress * 100);

  return (
    <Text>
      <Text color="cyan">{bar}</Text>
      <Text> {percent}%</Text>
    </Text>
  );
}
```

### 5.3 权限确认的交互设计

权限确认是 Agent 安全性和用户信任的核心环节。设计需要兼顾安全性和流畅性。

```jsx
function PermissionPrompt({ toolCall, onDecision }) {
  const [selected, setSelected] = useState(0);
  const options = [
    { label: 'Allow once',    key: 'y', color: 'green',  value: 'once' },
    { label: 'Deny',          key: 'n', color: 'red',    value: 'deny' },
    { label: 'Always allow',  key: 'a', color: 'blue',   value: 'always' },
    { label: 'Deny all',      key: 'd', color: 'red',    value: 'deny_all' },
  ];

  useInput((input, key) => {
    // 快捷键直接选择
    const option = options.find(o => o.key === input.toLowerCase());
    if (option) {
      onDecision(option.value);
      return;
    }

    // 方向键导航
    if (key.leftArrow) setSelected(s => Math.max(0, s - 1));
    if (key.rightArrow) setSelected(s => Math.min(options.length - 1, s + 1));
    if (key.return) onDecision(options[selected].value);
  });

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      paddingX={1}
      paddingY={0}
    >
      {/* 标题 */}
      <Text bold color="yellow">
        {' Permission Required '}
      </Text>

      {/* 工具信息 */}
      <Box marginTop={1} flexDirection="column">
        <Text>Tool: <Text bold>{toolCall.name}</Text></Text>
        <Box marginLeft={2}>
          <ToolArgsPreview toolCall={toolCall} />
        </Box>
      </Box>

      {/* 风险说明 */}
      {toolCall.risk && (
        <Box marginTop={1}>
          <Text color="yellow">
            Note: {toolCall.risk}
          </Text>
        </Box>
      )}

      {/* 选项 */}
      <Box marginTop={1} gap={2}>
        {options.map((opt, i) => (
          <Text
            key={opt.key}
            color={opt.color}
            bold={i === selected}
            inverse={i === selected}
          >
            {` [${opt.key.toUpperCase()}] ${opt.label} `}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

权限确认的 UX 原则：

1. **信息充分**：清楚地展示工具名称、参数、潜在影响，让用户能做出知情决定
2. **操作便捷**：提供快捷键（Y/N/A），避免每次都要移动光标
3. **记忆机制**："Always allow" 减少重复确认的烦恼，但仅限当前会话
4. **风险分级**：只读操作（如读文件）可以设置为默认允许；写入操作需要确认；危险操作（如 `rm -rf`）需要额外警告
5. **超时处理**：如果用户长时间不响应，显示提醒或自动拒绝（安全优先）

```
风险分级示例：

低风险（可自动允许）:
  - read_file: 读取文件
  - search: 搜索内容
  - list_directory: 列出目录

中风险（需确认）:
  - write_file: 写入文件
  - bash（安全命令）: ls, cat, grep 等

高风险（强制确认 + 警告）:
  - bash（危险命令）: rm, chmod, sudo 等
  - 网络请求: curl, wget 等
  - 修改系统配置
```

---

## 总结

UI 层的设计直接影响用户对 AI Agent 的体验和信任感。核心要点：

1. **技术选型**：Ink（React for CLI）通过声明式渲染、组件化、Hooks 等机制，让复杂的终端 UI 变得可维护和可扩展
2. **双模式设计**：交互式模式面向人类用户，提供丰富的 TUI 体验；Headless 模式面向程序调用，支持管道、SDK、CI/CD 等场景
3. **输出格式**：text、json、stream-json 三种格式覆盖了从简单到复杂的所有消费场景
4. **流式 UX**：打字机效果、工具调用可视化、权限确认对话框共同构成了流畅且安全的交互体验
5. **安全与效率的平衡**：权限确认机制通过风险分级和快捷操作，在不牺牲安全性的前提下保持操作流畅

UI 不仅仅是"好看"，它是人与 Agent 之间信任链的可视化载体。
