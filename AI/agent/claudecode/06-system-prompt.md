# 06 - System Prompt 构建详解

## 一、System Prompt 的重要性

### 1.1 什么是 System Prompt？

System Prompt 是 AI Agent 启动时注入的**第一段指令文本**，它在用户发送任何消息之前就已经存在于对话上下文中。它定义了 Agent 的：

- **行为边界**：Agent 能做什么、不能做什么
- **能力声明**：Agent 擅长处理哪些任务
- **交互风格**：如何与用户沟通（语气、格式、语言）
- **安全护栏**：哪些操作需要确认，哪些被禁止

可以将 System Prompt 类比为 Agent 的**"操作系统"**——应用程序（用户指令）运行在操作系统之上，操作系统决定了应用程序的运行环境和边界。

### 1.2 为什么需要分层构建？

一个朴素的做法是把所有指令写在一个大字符串里，但这会带来严重问题：

```
// 反模式：单一巨型 prompt
const systemPrompt = `
  你是一个编程助手...
  你的安全规则是...
  当前项目使用 React...
  当前 Git 分支是 main...
  用户偏好用中文...
  可用工具有 Read, Write, Bash...
`
```

**问题所在：**

| 问题 | 说明 |
|------|------|
| 不可维护 | 所有内容混在一起，修改一处可能影响其他部分 |
| 不可复用 | 换一个项目就要重写整个 prompt |
| 不可扩展 | 新增能力（如 MCP 工具）需要手动拼接 |
| Token 浪费 | 无法按优先级裁剪，要么全部保留要么全部丢弃 |

**分层架构的优势：**

```
┌─────────────────────────────────────────┐
│  第五层：动态附加（运行时扩展）           │  ← 随时变化
├─────────────────────────────────────────┤
│  第四层：自定义追加（临时指令）           │  ← 每次调用可不同
├─────────────────────────────────────────┤
│  第三层：系统上下文（环境感知）           │  ← 每次会话刷新
├─────────────────────────────────────────┤
│  第二层：用户上下文（项目配置）           │  ← 每个项目不同
├─────────────────────────────────────────┤
│  第一层：核心 System Prompt（基础宪法）   │  ← 永远不变
└─────────────────────────────────────────┘
```

每一层职责清晰、独立可控，组合起来形成完整的 Agent 人格和能力。

---

## 二、五层 System Prompt 架构详解

### 第一层：核心 System Prompt（内置基础指令）

这是 Agent 的**"宪法"**，由 Agent 框架开发者编写，用户无法修改。它确保 Agent 在任何场景下都遵守基本规范。

#### 包含内容

**1. 工具使用指南**

告诉模型有哪些工具可用、每个工具的参数格式、调用时机。

Anthropic API 的工具调用使用**原生 JSON content block**格式，而不是 XML 标签：

```json
// API 请求中定义可用工具
{
  "tools": [
    {
      "name": "Read",
      "description": "Reads a file from the local filesystem.",
      "input_schema": {
        "type": "object",
        "required": ["file_path"],
        "properties": {
          "file_path": { "type": "string", "description": "The absolute path to the file" }
        }
      }
    }
  ]
}

// 模型返回工具调用时，在 assistant message 的 content 中包含 tool_use block：
{
  "type": "tool_use",
  "id": "toolu_xxxxx",
  "name": "Read",
  "input": { "file_path": "/absolute/path/to/file" }
}
```

系统提示中还包含工具使用的最佳实践指南：

```markdown
Guidelines:
- For file searches: search broadly when you don't know where something lives.
  Use Read when you know the specific file path.
- For analysis: Start broad and narrow down.
- NEVER create files unless absolutely necessary.
- ALWAYS prefer editing an existing file to creating a new one.
```

**2. 安全规则**

```markdown
Security Rules:
- NEVER execute commands that could harm the system (rm -rf /, etc.)
- NEVER expose secrets, API keys, or credentials in output
- ALWAYS ask for confirmation before destructive operations
- Do NOT access files outside the project directory without permission
```

**3. 代码风格指南**

```markdown
Code Style:
- Use absolute file paths, never relative
- Include code snippets only when the exact text is load-bearing
- Do not recap code you merely read
- Avoid using emojis in communication
```

**4. Git 操作规范**

```markdown
Git Operations:
- Check git status before making commits
- Use conventional commit messages
- Do not force push to shared branches
- Create feature branches for significant changes
```

#### 设计原则

- **不可协商**：用户无法通过 prompt injection 绕过这些规则
- **最小化**：只包含必须全局遵守的规则，避免臃肿
- **稳定性**：极少更新，每次更新需要严格审查

```typescript
// 伪代码：核心 prompt 的加载方式
class AgentRuntime {
  private readonly CORE_SYSTEM_PROMPT = loadFromInternal('core-prompt.txt');

  buildSystemPrompt(): string {
    // 第一层永远是基础
    let prompt = this.CORE_SYSTEM_PROMPT;
    // 后续层叠加...
    return prompt;
  }
}
```

---

### 第二层：用户上下文 (userContext)

这一层承载**项目特定的约定和知识**，让 Agent 理解"我在为哪个项目工作"。

#### CLAUDE.md 文件

这是最核心的用户上下文载体。类似于 `.editorconfig`、`.eslintrc` 是给编辑器和 Linter 看的配置，`CLAUDE.md` 是给 AI Agent 看的配置：

```markdown
# CLAUDE.md（示例）

## Repository Purpose
This is a React + TypeScript monorepo for an e-commerce platform.

## Conventions
- Use pnpm as package manager (NOT npm or yarn)
- All components use functional style with hooks
- State management: Zustand (NOT Redux)
- Styling: Tailwind CSS utility classes
- Testing: Vitest + React Testing Library
- Commit messages: conventional commits in English

## Project Structure
- apps/web — Next.js frontend
- apps/api — Express backend
- packages/ui — Shared component library
- packages/types — Shared TypeScript types

## Common Commands
- pnpm dev — Start all apps in dev mode
- pnpm test — Run all tests
- pnpm build — Production build
- pnpm lint — Lint all packages
```

#### 加载机制

```typescript
// 用户上下文的收集过程
function collectUserContext(projectRoot: string): string {
  const contexts: string[] = [];

  // 1. 读取项目根目录的 CLAUDE.md
  const rootClaudeMd = readIfExists(path.join(projectRoot, 'CLAUDE.md'));
  if (rootClaudeMd) {
    contexts.push(`Project instructions from CLAUDE.md:\n${rootClaudeMd}`);
  }

  // 2. 读取当前工作子目录的 CLAUDE.md（如果不同于根目录）
  const cwdClaudeMd = readIfExists(path.join(cwd, 'CLAUDE.md'));
  if (cwdClaudeMd && cwdClaudeMd !== rootClaudeMd) {
    contexts.push(`Local instructions:\n${cwdClaudeMd}`);
  }

  return contexts.join('\n\n');
}
```

#### 注入方式

用户上下文通常被包裹在特定标签中，以便模型区分不同来源的指令：

```xml
<system-reminder>
As you answer the user's questions, you can use the following context:

# claudeMd
Contents of /path/to/project/CLAUDE.md (project instructions):
[CLAUDE.md 内容]
</system-reminder>
```

---

### 第三层：系统上下文 (systemContext)

这一层提供 **运行时环境信息**，让 Agent 感知"我在什么环境下运行"。

#### 包含内容

**1. Git 状态**

```markdown
# gitStatus
Current branch: feature/user-auth
Main branch: main

Status:
 M src/auth/login.ts
 M src/auth/register.ts
?? src/auth/forgot-password.ts

Recent commits:
a1b2c3d feat: add login page
d4e5f6g feat: add user model
```

**2. 环境信息**

```markdown
Working directory: /Users/dev/my-project
Is directory a git repo: Yes
Platform: darwin
Shell: zsh
OS Version: Darwin 24.0.0
```

**3. 日期/时间**

```markdown
# currentDate
Today's date is 2026-03-20.
```

#### 为什么需要这些信息？

| 信息 | 用途 |
|------|------|
| Git 分支 | 决定 PR 的 base branch、commit message 风格 |
| 修改文件列表 | 了解当前工作焦点，给出更精准的建议 |
| 平台信息 | 选择正确的命令（`pbcopy` vs `xclip`、`open` vs `xdg-open`） |
| Shell 类型 | 生成正确的 shell 语法（bash vs zsh vs fish） |
| 当前日期 | 避免生成过期的时间引用 |

#### 实现示例

```typescript
async function buildSystemContext(): Promise<string> {
  const parts: string[] = [];

  // Git 状态
  const gitStatus = await execCommand('git status --short');
  const gitBranch = await execCommand('git branch --show-current');
  const gitLog = await execCommand('git log --oneline -5');
  parts.push(`# gitStatus\nCurrent branch: ${gitBranch}\n\nStatus:\n${gitStatus}\n\nRecent commits:\n${gitLog}`);

  // 环境信息
  parts.push(`Working directory: ${process.cwd()}`);
  parts.push(`Platform: ${process.platform}`);
  parts.push(`Shell: ${process.env.SHELL}`);
  parts.push(`OS Version: ${os.type()} ${os.release()}`);

  // 日期
  parts.push(`# currentDate\nToday's date is ${new Date().toISOString().split('T')[0]}.`);

  return parts.join('\n\n');
}
```

---

### 第四层：自定义追加 (appendSystemPrompt)

这一层是**临时性的指令注入**，用于特定场景下覆盖或补充默认行为。

#### 使用场景

**1. CLI 参数注入**

```bash
# 通过命令行参数追加指令
claude --append-system-prompt "Always respond in Japanese"
claude --append-system-prompt "Focus only on security review"
```

**2. Agent 定义中的额外指令**

当一个 Agent 被定义为执行特定任务时，可以附加任务专属的 prompt：

```typescript
// Agent 定义
const codeReviewAgent = {
  name: 'Code Reviewer',
  appendSystemPrompt: `
    You are a senior code reviewer. For every change:
    1. Check for security vulnerabilities
    2. Verify error handling completeness
    3. Assess test coverage
    4. Review naming conventions
    5. Rate the change: APPROVE / REQUEST_CHANGES / COMMENT

    Format your review as a structured report.
  `
};
```

**3. 多 Agent 协作中的角色分配**

```typescript
// 主 Agent 派生子 Agent 时注入角色
const subAgent = spawnAgent({
  task: 'Write unit tests for the auth module',
  appendSystemPrompt: `
    You are a testing specialist.
    Use Vitest and React Testing Library.
    Achieve >90% branch coverage.
    Do NOT modify source code, only create/edit test files.
  `
});
```

#### 优先级

当自定义追加与前面的层级冲突时，通常**追加内容优先级更高**（后出现的指令覆盖先出现的），但**不能覆盖第一层的安全规则**：

```
安全规则（第一层）  →  不可覆盖
项目约定（第二层）  →  可被第四层临时覆盖
环境信息（第三层）  →  事实性信息，不存在覆盖问题
自定义追加（第四层）→  最高业务优先级
```

---

### 第五层：动态附加

这一层在**运行时动态生成**，内容会随着会话进展和环境变化而更新。

#### 1. Auto Memory（记忆功能）

Agent 在会话过程中学到的知识可以被持久化到 `CLAUDE.md` 或 `~/.claude/` 目录下的记忆文件中，下次启动时作为上下文自动加载：

```markdown
# 记忆内容示例（存储在 CLAUDE.md 或记忆文件中）

## 项目偏好
- 用户偏好使用 pnpm，不使用 npm
- 代码注释使用中文
- 提交信息使用英文

## 已知问题
- node_modules 在 packages/ui 下有时需要手动删除重装
- CI 在 ARM 架构下运行较慢

## 用户习惯
- 喜欢先看整体架构再深入细节
- 偏好函数式编程风格
```

#### 2. Skills/Commands 定义

可复用的技能和命令模板：

```markdown
## Available Skills

### /deploy
Deploy the current branch to staging environment.
Steps:
1. Run `pnpm build`
2. Run `pnpm test`
3. If tests pass, run `./scripts/deploy-staging.sh`

### /review
Perform code review on staged changes.
Steps:
1. Run `git diff --staged`
2. Analyze each file for issues
3. Generate structured review report
```

#### 3. MCP 工具描述

当通过 MCP (Model Context Protocol) 连接外部工具时，工具的描述会被动态注入：

```markdown
## MCP Tools Available

### confluence_search
Search Confluence pages by query string.
Parameters:
- query (string, required): Search query
- space (string, optional): Space key to filter

### confluence_get_content
Get the content of a specific Confluence page.
Parameters:
- page_id (string, required): The page ID
```

#### 动态性体现

```typescript
function buildDynamicAttachments(): string {
  const parts: string[] = [];

  // Memory：每次会话开始时加载
  const memory = loadMemory();
  if (memory) parts.push(memory);

  // Skills：根据已注册的命令生成
  const skills = getRegisteredSkills();
  if (skills.length > 0) {
    parts.push('## Available Skills\n' + skills.map(s => s.describe()).join('\n'));
  }

  // MCP Tools：根据已连接的 MCP Server 动态生成
  const mcpTools = getConnectedMCPTools();
  if (mcpTools.length > 0) {
    parts.push('## MCP Tools\n' + mcpTools.map(t => t.schema()).join('\n'));
  }

  // Deferred Tools：延迟加载的工具列表
  const deferredTools = getDeferredToolList();
  if (deferredTools.length > 0) {
    parts.push(`<available-deferred-tools>\n${deferredTools.join('\n')}\n</available-deferred-tools>`);
  }

  return parts.join('\n\n');
}
```

---

## 三、CLAUDE.md 的设计理念

### 3.1 类比已有配置文件

| 配置文件 | 服务对象 | 配置内容 |
|----------|----------|----------|
| `.editorconfig` | 编辑器 | 缩进、换行符、编码 |
| `.eslintrc` | ESLint | 代码规范规则 |
| `.prettierrc` | Prettier | 格式化风格 |
| `tsconfig.json` | TypeScript | 编译选项 |
| **`CLAUDE.md`** | **AI Agent** | **项目约定、结构、命令** |

CLAUDE.md 的核心思想是：**让 AI 像人类新成员一样，通过阅读一份文档就能理解项目的"潜规则"。**

### 3.2 层级支持

CLAUDE.md 支持多级覆盖，与 `.gitignore` 的层级逻辑一致：

```
~/                         ← 全局级（用户个人偏好）
├── .claude/
│   └── CLAUDE.md          # "我喜欢中文回复、函数式风格"
│
└── Code/
    └── my-project/        ← 项目级
        ├── CLAUDE.md      # "这是 React 项目，用 pnpm"
        │
        ├── packages/
        │   └── api/       ← 子目录级
        │       └── CLAUDE.md  # "这是 Express API，遵循 RESTful"
        │
        └── apps/
            └── web/       ← 子目录级
                └── CLAUDE.md  # "这是 Next.js App Router"
```

**加载优先级**（后加载的内容优先级更高）：

```
全局 CLAUDE.md → 项目根 CLAUDE.md → 子目录 CLAUDE.md
```

### 3.3 编写最佳实践

**DO（推荐）：**

```markdown
## Project Structure
- src/components — React components (one component per file)
- src/hooks — Custom hooks (prefix with "use")
- src/api — API client functions (auto-generated from OpenAPI)

## Commands
- pnpm dev — Start development server on port 3000
- pnpm test:unit — Run unit tests with Vitest

## Conventions
- Use named exports, not default exports
- Error handling: wrap async calls in try/catch, log to Sentry
- Database queries go through the repository pattern in src/repos/
```

**DON'T（避免）：**

```markdown
<!-- 太模糊 -->
## Rules
Please write good code.

<!-- 太冗长 -->
## Coding Guide
[复制粘贴了 200 行编码规范...]

<!-- 与 AI 无关 -->
## Team Schedule
每周三下午有 standup meeting...
```

---

## 四、System Prompt 的 Token 预算管理

### 4.1 问题背景

每个 LLM 都有**上下文窗口限制**（如 Claude 3.5 约 200K tokens）。System Prompt 占据的空间越多，留给用户对话和工具输出的空间就越少：

```
┌──────────────── 总上下文窗口（200K tokens）──────────────────┐
│                                                              │
│  ┌─────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ System      │ │ 对话历史          │ │ 剩余空间          │  │
│  │ Prompt      │ │ (用户+助手+工具)  │ │ (新的回复)        │  │
│  │ ~10K        │ │ ~150K            │ │ ~40K              │  │
│  └─────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 各层的 Token 预算分配

| 层级 | 典型大小 | 优先级 | 可裁剪？ |
|------|----------|--------|----------|
| 第一层：核心 prompt | 2K-5K tokens | 最高 | 不可裁剪 |
| 第二层：CLAUDE.md | 1K-3K tokens | 高 | 可以截断长文件 |
| 第三层：系统上下文 | 0.5K-1K tokens | 中 | 可以省略详细 git log |
| 第四层：自定义追加 | 0.2K-1K tokens | 高 | 由调用者控制 |
| 第五层：动态附加 | 1K-5K tokens | 中 | 可以按需加载 |

### 4.3 截断策略

```typescript
function buildFinalPrompt(budget: number): string {
  const layers: Array<{ content: string; priority: number; minTokens: number }> = [
    { content: corePrompt,       priority: 1, minTokens: Infinity },  // 不可裁剪
    { content: appendPrompt,     priority: 2, minTokens: 100 },
    { content: claudeMd,         priority: 3, minTokens: 200 },
    { content: dynamicAttach,    priority: 4, minTokens: 100 },
    { content: systemContext,    priority: 5, minTokens: 50 },
  ];

  // 按优先级排序，高优先级先分配
  layers.sort((a, b) => a.priority - b.priority);

  let remaining = budget;
  const result: string[] = [];

  for (const layer of layers) {
    const tokens = countTokens(layer.content);
    if (tokens <= remaining) {
      result.push(layer.content);
      remaining -= tokens;
    } else if (remaining >= layer.minTokens) {
      // 截断到剩余空间
      result.push(truncateToTokens(layer.content, remaining));
      remaining = 0;
    }
    // 否则跳过该层
  }

  return result.join('\n\n');
}
```

### 4.4 优化技巧

1. **延迟加载工具定义**：不在 System Prompt 中列出所有工具的完整 schema，而是只列出名称，需要时再加载（即 deferred tools 机制）

```xml
<!-- 只占少量 token -->
<available-deferred-tools>
Bash, Read, Write, Edit, Grep, Glob
</available-deferred-tools>

<!-- 用户需要时再通过 ToolSearch 获取完整 schema -->
```

2. **摘要而非全文**：对超长的 CLAUDE.md，生成摘要版本

3. **条件加载**：根据用户意图动态决定加载哪些内容
   - 用户问代码问题 → 加载完整项目结构
   - 用户问 Git 问题 → 加载详细 Git 状态
   - 用户闲聊 → 最小化上下文

---

## 五、对比其他 Agent 框架的 Prompt 设计

### 5.1 各框架对比

| 特性 | Claude Code | OpenAI Assistants | LangChain Agents | AutoGPT |
|------|-------------|-------------------|-------------------|---------|
| Prompt 分层 | 五层架构 | 两层（system + instructions） | 单层（自定义 prompt） | 三层（goals + constraints + resources） |
| 项目配置文件 | CLAUDE.md | 无原生支持 | 无原生支持 | ai_settings.yaml |
| 环境感知 | 自动注入 Git/OS/Shell | 需手动实现 | 需手动实现 | 有限的文件系统感知 |
| 动态扩展 | MCP + Skills + Memory | Function calling | Tools + Toolkits | Plugins |
| Token 管理 | 分层优先级截断 | 截断策略不透明 | 需自行实现 | 固定预算 |

### 5.2 OpenAI Assistants API

```python
# OpenAI 的 System Prompt 结构相对简单
assistant = client.beta.assistants.create(
    name="Code Helper",
    instructions="""
    You are a helpful code assistant.
    Follow the user's coding style.
    Use TypeScript when possible.
    """,  # 这就是全部的 system prompt
    tools=[{"type": "code_interpreter"}, {"type": "file_search"}],
    model="gpt-4-turbo"
)
```

**差异点**：
- 没有分层概念，所有指令放在一个 `instructions` 字段中
- 工具定义通过 API 参数传入，而非嵌入 prompt
- 没有原生的项目配置文件机制

### 5.3 LangChain ReAct Agent

```python
# LangChain 需要手动组装 prompt
from langchain.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages([
    ("system", """You are a helpful assistant.
    You have access to the following tools: {tools}

    Use the following format:
    Thought: what I need to do
    Action: tool_name
    Action Input: input
    Observation: result
    """),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])
```

**差异点**：
- Prompt 模板需要开发者完全手写
- 灵活但缺乏标准化
- 没有内置的环境感知和项目配置

### 5.4 AutoGPT

```yaml
# AutoGPT 的 ai_settings.yaml
ai_name: CodeBot
ai_role: A senior software engineer
ai_goals:
  - Review code for bugs
  - Suggest performance improvements
  - Write comprehensive tests
ai_constraints:
  - Never delete files without confirmation
  - Stay within the project directory
ai_resources:
  - Access to terminal
  - Access to file system
```

**差异点**：
- 使用 YAML 配置而非 Markdown
- 目标导向（goals）而非指令导向
- 约束（constraints）类似于安全规则，但可被用户修改

### 5.5 核心设计差异总结

Claude Code 的五层架构最大的设计理念差异在于：

```
其他框架：  开发者负责构建完整 prompt
              ↓
Claude Code：框架负责构建大部分 prompt，用户通过 CLAUDE.md 补充项目知识
```

这种**"框架承担复杂性，用户只需声明意图"**的理念，让非 AI 专家的普通开发者也能高效使用 Agent，而不需要深入了解 prompt engineering。

---

## 六、总结

System Prompt 的五层架构是一个精心设计的**关注点分离**方案：

```
第一层（核心）    → 回答 "Agent 是什么"          → 框架开发者负责
第二层（用户）    → 回答 "项目有什么约定"        → 项目维护者负责（CLAUDE.md）
第三层（系统）    → 回答 "当前环境是什么"        → 自动收集
第四层（追加）    → 回答 "这次任务有什么特殊要求" → 调用者指定
第五层（动态）    → 回答 "Agent 还能做什么"      → 运行时发现
```

理解这个架构，就理解了 AI Agent 如何从一个通用模型变成一个**懂你项目、懂你环境、懂你需求**的专属助手。
