# 04 - 工具系统详解 (Tool System)

> 基于 Claude Code v2.1.80 逆向分析，深入剖析 Agent 工具系统的设计、注册、调度与执行机制。

---

## 目录

1. [工具系统的设计哲学](#1-工具系统的设计哲学)
2. [内置工具完整列表与详解](#2-内置工具完整列表与详解)
3. [工具注册与调度机制](#3-工具注册与调度机制)
4. [Vendor 依赖](#4-vendor-依赖)
5. [Edit vs Write 的设计考量](#5-edit-vs-write-的设计考量)
6. [工具调用的生命周期](#6-工具调用的生命周期)

---

## 1. 工具系统的设计哲学

### 1.1 为什么 Agent 需要工具？

LLM 本质上是一个**文本生成器**——给定输入 tokens，输出概率最高的下一组 tokens。它具有以下根本性限制：

| 限制 | 说明 |
|------|------|
| **无法感知外部世界** | LLM 不知道当前时间、文件系统状态、网络上的最新信息 |
| **无法执行操作** | LLM 不能运行代码、修改文件、发送请求 |
| **无法验证输出** | LLM 无法自动检查它写的代码是否能编译通过 |
| **知识有截止日期** | 训练数据有时间边界，无法获取最新信息 |

工具系统的本质是为 LLM 赋予**"行动"能力**，让它从一个"只会说话的顾问"升级为一个"能动手干活的工程师"。

```
┌─────────────────────────────────────────────────────────┐
│                      无工具的 LLM                        │
│                                                         │
│   用户: "帮我在项目里找到所有TODO注释"                      │
│   LLM:  "你可以用 grep -r 'TODO' . 来查找..."           │
│         （只能给建议，不能真正执行）                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    有工具的 Agent                         │
│                                                         │
│   用户: "帮我在项目里找到所有TODO注释"                      │
│   Agent: 调用 Grep(pattern="TODO") → 得到实际结果          │
│          "我找到了 12 处 TODO 注释，分布在以下文件中..."     │
│         （直接执行并返回真实结果）                          │
└─────────────────────────────────────────────────────────┘
```

### 1.2 "工具即函数调用" (Function Calling) 的本质

Claude Code 中的工具系统本质上是 **Function Calling** 模式的工程化实现。核心思想如下：

1. **工具 = 结构化的函数定义**：每个工具用 JSON Schema 描述其名称、用途、参数格式
2. **LLM 选择工具 = 生成结构化 JSON**：LLM 并不是"调用"函数，而是生成一段特殊格式的 JSON，声明它想使用哪个工具、传什么参数
3. **宿主程序执行工具 = 真正的函数调用**：Agent 框架解析 LLM 的输出，执行对应的函数，并将结果作为新的上下文反馈给 LLM

```
┌──────────┐     tool_use 消息        ┌──────────────┐
│          │  ──────────────────────>  │              │
│   LLM    │    {tool: "Bash",        │  Agent 框架   │
│ (Claude) │     args: {cmd: "ls"}}   │  (宿主程序)    │
│          │  <──────────────────────  │              │
└──────────┘     tool_result 消息      └──────────────┘
                 {output: "file1.js\nfile2.ts"}
```

关键洞察：**LLM 本身并不知道工具是如何实现的**，它只是学会了"在什么情况下生成什么格式的工具调用请求"。真正的能力来自宿主程序的执行层。

### 1.3 Claude Code 中的工具理念

Claude Code 的工具系统遵循几个核心设计原则：

- **最小权限原则**：每个工具只暴露必要的能力，配合权限系统控制访问
- **组合优于继承**：工具之间是平级的，通过 Agent Loop 的多轮调用实现复杂操作
- **明确的输入/输出契约**：所有工具通过 JSON Schema 定义参数，确保 LLM 理解如何使用
- **幂等性考虑**：部分工具（如 Read、Glob、Grep）是只读的，天然幂等；写入工具则通过精确的 diff 机制避免意外覆盖

---

## 2. 内置工具完整列表与详解

### 2.1 工具总览

Claude Code 内置了约 20+ 个工具，按功能可分为以下几类：

| 类别 | 工具名 | 一句话说明 | 读/写 |
|------|--------|-----------|-------|
| **命令执行** | `Bash` | 执行 shell 命令 | 写 |
| **文件读取** | `Read` (FileRead) | 读取文件内容 | 读 |
| **文件写入** | `Write` (FileWrite) | 创建或覆盖文件 | 写 |
| **文件编辑** | `Edit` (FileEdit) | 基于 diff 的精确编辑 | 写 |
| **文件搜索** | `Glob` | 文件路径模式匹配 | 读 |
| **内容搜索** | `Grep` | 基于 ripgrep 的内容搜索 | 读 |
| **子任务** | `Agent` | 启动子 Agent 处理子任务 | 混合 |
| **网络请求** | `WebFetch` | HTTP 请求获取网页/API | 读 |
| **网页搜索** | `WebSearch` | 在线搜索引擎查询 | 读 |
| **Notebook** | `NotebookEdit` | Jupyter Notebook 编辑 | 写 |
| **用户交互** | `AskUserQuestion` | 向用户提问获取信息 | 读 |
| **后台任务** | `TaskCreate` | 创建后台任务 | 写 |
| **后台任务** | `TaskGet` | 获取任务状态 | 读 |
| **后台任务** | `TaskList` | 列出所有任务 | 读 |
| **后台任务** | `TaskStop` | 停止任务 | 写 |
| **后台任务** | `TaskUpdate` | 更新任务 | 写 |
| **后台任务** | `TaskOutput` | 获取任务输出 | 读 |
| **Git 隔离** | `EnterWorktree` | 进入 Git Worktree 隔离环境 | 写 |
| **Git 隔离** | `ExitWorktree` | 退出 Git Worktree | 写 |
| **配置管理** | `Config` | 管理 Claude Code 配置 | 混合 |
| **外部扩展** | `MCP Tools` | 通过 MCP 协议接入的外部工具 | 混合 |

### 2.2 各工具详解

---

#### 2.2.1 Bash — Shell 命令执行

**核心功能**：在宿主系统中执行任意 shell 命令，是 Agent 最强大也最危险的工具。

**参数定义**：

```json
{
  "command": {
    "type": "string",
    "description": "要执行的命令"
  },
  "timeout": {
    "type": "number",
    "description": "超时时间（毫秒），最大 600000（10分钟），默认 120000（2分钟）"
  },
  "run_in_background": {
    "type": "boolean",
    "description": "是否后台运行"
  },
  "description": {
    "type": "string",
    "description": "命令描述，用于用户审查"
  }
}
```

**关键特性**：

| 特性 | 说明 |
|------|------|
| **沙箱执行** | 默认在沙箱中运行，限制网络访问和文件系统操作范围 |
| **后台模式** | `run_in_background: true` 使命令在后台运行，不阻塞主循环 |
| **超时控制** | 可配置超时（最长 10 分钟），防止死循环命令 |
| **安全解析** | 使用 tree-sitter-bash 解析命令语法，识别危险操作 |
| **工作目录** | 每次调用工作目录重置为项目根目录（不保持 cd 状态） |
| **描述字段** | 要求 LLM 提供命令描述，便于用户审查授权 |

**使用示例**：

```json
{
  "tool": "Bash",
  "args": {
    "command": "npm install && npm run build",
    "description": "安装依赖并构建项目",
    "timeout": 300000
  }
}
```

**安全机制**：
- 命令经过 tree-sitter-bash 解析，提取操作语义
- 配合权限系统判断是否需要用户确认
- 沙箱模式限制可访问的路径和命令
- 危险命令（`rm -rf /`、`git push --force` 等）触发额外警告

---

#### 2.2.2 Read (FileRead) — 文件读取

**核心功能**：读取本地文件系统上的文件，支持多种文件格式。

**参数定义**：

```json
{
  "file_path": {
    "type": "string",
    "description": "文件的绝对路径"
  },
  "offset": {
    "type": "number",
    "description": "起始行号（可选，用于大文件分段读取）"
  },
  "limit": {
    "type": "number",
    "description": "读取行数（可选，默认 2000 行）"
  },
  "pages": {
    "type": "string",
    "description": "PDF 页码范围，如 '1-5'（仅适用于 PDF）"
  }
}
```

**支持的文件类型**：

| 文件类型 | 处理方式 |
|----------|----------|
| 文本文件 (`.js`, `.ts`, `.py`, `.md` 等) | 直接读取，输出带行号（`cat -n` 格式） |
| 图片 (`.png`, `.jpg`, `.gif`, `.webp`) | 以多模态方式呈现给 LLM（Claude 是多模态模型） |
| PDF (`.pdf`) | 提取文本内容，大 PDF 必须指定页码范围（每次最多 20 页） |
| Jupyter Notebook (`.ipynb`) | 解析所有 cell，合并代码、文本和可视化输出 |

**关键细节**：
- 必须使用**绝对路径**
- 默认读取前 2000 行，大文件需要分段读取
- 读到空文件会收到系统警告
- 读目录会失败（需要用 Bash 的 `ls`）

---

#### 2.2.3 Write (FileWrite) — 文件写入

**核心功能**：创建新文件或完全覆盖已有文件。

**参数定义**：

```json
{
  "file_path": {
    "type": "string",
    "description": "文件的绝对路径"
  },
  "content": {
    "type": "string",
    "description": "要写入的完整内容"
  }
}
```

**使用约束**：
- 如果是修改已有文件，**必须先用 Read 读取**（防止盲写覆盖）
- 会覆盖已有内容（不是追加）
- 修改已有文件时，**推荐优先使用 Edit 工具**（节省 tokens）
- 只有创建新文件或需要完全重写时才使用 Write

---

#### 2.2.4 Edit (FileEdit) — 精确编辑

**核心功能**：基于 `old_string` → `new_string` 的精确文本替换，实现文件的局部修改。

**参数定义**：

```json
{
  "file_path": {
    "type": "string",
    "description": "文件的绝对路径"
  },
  "old_string": {
    "type": "string",
    "description": "要被替换的原始文本（必须精确匹配）"
  },
  "new_string": {
    "type": "string",
    "description": "替换后的新文本"
  }
}
```

**工作原理**：

```
原始文件内容:
┌──────────────────────────────┐
│ line 1                       │
│ line 2 (old_string 部分)     │  ← 精确匹配这一段
│ line 3                       │
│ line 4                       │
└──────────────────────────────┘

Edit 操作后:
┌──────────────────────────────┐
│ line 1                       │
│ line 2 (new_string 部分)     │  ← 只替换匹配到的部分
│ line 3                       │
│ line 4                       │
└──────────────────────────────┘
```

**关键特性**：
- `old_string` 必须在文件中**唯一匹配**（如果多处匹配会失败）
- 只传输差异部分，极大节省 token 消耗（详见第 5 节）
- 当 `old_string` 为空时，等同于在文件开头插入 `new_string`

---

#### 2.2.5 Glob — 文件路径模式匹配

**核心功能**：使用 glob 模式在文件系统中快速查找文件。

**参数定义**：

```json
{
  "pattern": {
    "type": "string",
    "description": "Glob 模式，如 '**/*.ts' 或 'src/**/*.test.js'"
  },
  "path": {
    "type": "string",
    "description": "搜索的根目录（可选，默认当前工作目录）"
  }
}
```

**使用场景**：
- 查找特定类型的文件：`**/*.tsx`
- 查找特定名称的文件：`**/package.json`
- 结果按修改时间排序

**与 `Bash` + `find` 的对比**：

| 维度 | Glob 工具 | `find` 命令 |
|------|-----------|-------------|
| 速度 | 优化的内置实现 | 依赖系统命令 |
| 安全性 | 无副作用，只读 | 可能被注入危险操作 |
| 输出格式 | 结构化返回 | 纯文本需要解析 |
| 推荐度 | 优先使用 | 仅在需要复杂条件时使用 |

---

#### 2.2.6 Grep — 内容搜索

**核心功能**：基于 ripgrep (`rg`) 的高性能文件内容搜索。

**参数定义**：

```json
{
  "pattern": {
    "type": "string",
    "description": "搜索模式（正则表达式）"
  },
  "path": {
    "type": "string",
    "description": "搜索路径（可选）"
  },
  "include": {
    "type": "string",
    "description": "文件名过滤模式，如 '*.ts'"
  }
}
```

**底层实现**：
- 依赖 vendor 打包的 **ripgrep** 二进制文件（不依赖系统安装）
- 自动忽略 `.gitignore` 中列出的文件
- 支持正则表达式搜索
- 比系统 `grep` 快数倍，尤其在大仓库中

---

#### 2.2.7 Agent — 子 Agent

**核心功能**：启动一个子 Agent 来处理复杂的子任务，实现任务分解。

**参数定义**：

```json
{
  "prompt": {
    "type": "string",
    "description": "子任务描述"
  }
}
```

**设计理念**：
- 子 Agent 拥有自己独立的消息上下文
- 可以使用除 Agent 以外的所有工具（防止无限递归）
- 适合处理开放性搜索、多步骤调查等任务
- 子 Agent 完成后将结果汇总返回给父 Agent

```
┌───────────┐
│ 父 Agent   │
│           │──── "调查一下所有 TODO 注释" ────┐
│           │                                  │
│           │                           ┌──────▼──────┐
│           │                           │  子 Agent    │
│           │                           │  - Grep TODO │
│           │                           │  - Read files│
│           │                           │  - 汇总结果   │
│           │  <── "共找到12处，分布在..." ──┘             │
│           │                           └─────────────┘
└───────────┘
```

---

#### 2.2.8 WebFetch — HTTP 请求

**核心功能**：发起 HTTP 请求获取网页内容或 API 数据。

**参数定义**：

```json
{
  "url": {
    "type": "string",
    "description": "请求 URL"
  },
  "method": {
    "type": "string",
    "description": "HTTP 方法 (GET/POST/...)"
  },
  "headers": {
    "type": "object",
    "description": "请求头"
  },
  "body": {
    "type": "string",
    "description": "请求体"
  }
}
```

**处理逻辑**：
- 对 HTML 页面自动提取正文内容（去除导航、广告等噪音）
- 对 API 响应直接返回 JSON
- 遵循重定向
- 有超时和大小限制

---

#### 2.2.9 WebSearch — 网页搜索

**核心功能**：通过搜索引擎查询信息，获取搜索结果摘要。

**使用场景**：
- 查询最新的库版本或 API 变更
- 搜索特定错误信息的解决方案
- 获取 LLM 训练数据截止日期之后的信息

---

#### 2.2.10 NotebookEdit — Jupyter Notebook 编辑

**核心功能**：编辑 Jupyter Notebook (`.ipynb`) 文件中的特定 cell。

**参数定义**：

```json
{
  "notebook_path": {
    "type": "string",
    "description": "Notebook 文件路径"
  },
  "cell_index": {
    "type": "number",
    "description": "要编辑的 cell 索引"
  },
  "new_source": {
    "type": "string",
    "description": "新的 cell 内容"
  },
  "cell_type": {
    "type": "string",
    "description": "cell 类型 (code/markdown)"
  }
}
```

**设计原因**：
- `.ipynb` 文件本质是 JSON 结构，直接用 Edit/Write 修改容易破坏结构
- NotebookEdit 理解 Notebook 的 cell 结构，确保编辑后的文件仍然有效

---

#### 2.2.11 AskUserQuestion — 向用户提问

**核心功能**：当 Agent 缺少必要信息时，主动向用户提问。

**参数定义**：

```json
{
  "question": {
    "type": "string",
    "description": "要问用户的问题"
  }
}
```

**设计理念**：
- 体现了 Agent 的"自主但不自大"原则
- 当任务存在歧义或需要确认时，主动提问而不是猜测
- 典型场景：需要选择方案、需要确认破坏性操作、缺少关键上下文

---

#### 2.2.12 TaskCreate / TaskGet / TaskList / TaskStop / TaskUpdate / TaskOutput — 后台任务管理

**核心功能**：管理异步后台任务的完整生命周期。

| 工具 | 功能 |
|------|------|
| `TaskCreate` | 创建一个新的后台任务 |
| `TaskGet` | 获取任务当前状态 |
| `TaskList` | 列出所有后台任务 |
| `TaskStop` | 停止正在运行的任务 |
| `TaskUpdate` | 更新任务参数/状态 |
| `TaskOutput` | 获取任务的输出结果 |

**使用场景**：
- 长时间运行的构建任务
- 并行执行多个独立的分析任务
- 启动开发服务器后继续其他操作

```
TaskCreate("npm run build")  →  task_id: "abc123"
    │
    ├── 继续做其他事情 ...
    │
TaskGet("abc123")  →  status: "running"
    │
    ├── 继续做其他事情 ...
    │
TaskOutput("abc123")  →  "Build completed successfully"
```

---

#### 2.2.13 EnterWorktree / ExitWorktree — Git Worktree 隔离

**核心功能**：创建和管理 Git Worktree，在独立的工作目录中进行操作，不影响主工作区。

| 工具 | 功能 |
|------|------|
| `EnterWorktree` | 创建一个新的 Git Worktree 并切换到该环境 |
| `ExitWorktree` | 退出 Worktree 并返回主工作区 |

**设计理念**：
- 需要在不同分支上工作时，避免 `git stash` / `git checkout` 的上下文切换成本
- 适合同时对比多个分支的代码
- Worktree 提供文件系统级别的隔离

---

#### 2.2.14 Config — 配置管理

**核心功能**：读取和修改 Claude Code 的配置项。

---

#### 2.2.15 MCP Tools — 外部扩展工具

**核心功能**：通过 MCP (Model Context Protocol) 协议接入的第三方工具。

**命名规范**：

```
mcp__{serverName}__{toolName}
```

例如：
- `mcp__confluence-mcp__confluence_search` — 搜索 Confluence 页面
- `mcp__github__create_issue` — 创建 GitHub Issue

**MCP 工具的特殊性**：
- 由外部 MCP Server 提供，工具列表动态生成
- 通过 stdio 或 SSE 与 MCP Server 通信
- 工具的 JSON Schema 由 MCP Server 声明
- 遵循 MCP 协议规范（详见 [09-mcp-integration.md](./09-mcp-integration.md)）

---

## 3. 工具注册与调度机制

### 3.1 工具加载流程

Claude Code 的工具系统采用**声明式注册 + 动态过滤**的架构：

```
┌─────────────────────────────────────────────────────────────┐
│                      工具加载流程                             │
│                                                             │
│  1. 启动阶段                                                 │
│     ├── 加载内置工具定义（硬编码在代码中）                       │
│     ├── 扫描 MCP 配置文件                                     │
│     └── 连接 MCP Servers，获取外部工具定义                      │
│                                                             │
│  2. 会话开始                                                  │
│     ├── 获取当前权限上下文（用户配置 + 环境信息）                 │
│     ├── 过滤出当前可用的工具列表                                │
│     └── 生成工具描述（JSON Schema），注入到 System Prompt        │
│                                                             │
│  3. 每轮对话                                                  │
│     ├── LLM 根据工具描述选择工具                                │
│     ├── 框架验证参数 → 检查权限 → 执行工具                      │
│     └── 结果作为 tool_result 返回给 LLM                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 基于权限上下文生成可用工具列表

并非所有工具在所有场景下都可用。Claude Code 会根据以下因素动态生成工具列表：

```typescript
// 伪代码：工具可用性判断
function getAvailableTools(context: PermissionContext): Tool[] {
  const allTools = [...builtinTools, ...mcpTools];

  return allTools.filter(tool => {
    // 1. 检查工具是否被全局禁用
    if (context.disabledTools.includes(tool.name)) return false;

    // 2. 检查是否满足环境要求
    if (tool.requiresNetwork && !context.hasNetwork) return false;

    // 3. 检查是否满足权限要求
    if (tool.requiresPermission && !context.hasPermission(tool.name)) return false;

    // 4. 子 Agent 中不能使用 Agent 工具（防止递归）
    if (tool.name === 'Agent' && context.isSubAgent) return false;

    return true;
  });
}
```

**权限分级**：

| 权限级别 | 代表工具 | 是否需要确认 |
|----------|----------|-------------|
| 只读 | `Read`, `Glob`, `Grep` | 不需要 |
| 写入 | `Write`, `Edit`, `NotebookEdit` | 根据配置 |
| 执行 | `Bash` | 通常需要确认 |
| 网络 | `WebFetch`, `WebSearch` | 根据配置 |
| 外部 | MCP Tools | 根据 MCP Server 配置 |

### 3.3 JSON Schema 输入验证

每个工具的参数通过 **JSON Schema** 进行严格验证：

```typescript
// 工具定义中包含参数 schema
const bashTool = {
  name: "Bash",
  description: "执行 shell 命令",
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description: "要执行的命令"
      },
      timeout: {
        type: "number",
        description: "超时（毫秒）",
        maximum: 600000
      },
      run_in_background: {
        type: "boolean"
      }
    },
    additionalProperties: false  // 不允许额外参数
  }
};

// 调用前验证
function validateToolInput(tool: Tool, args: unknown): ValidationResult {
  return jsonSchemaValidate(args, tool.parameters);
}
```

验证确保：
- 必填参数不缺失
- 参数类型正确
- 不含未定义的额外参数
- 数值在允许范围内

### 3.4 MCP 工具命名空间

MCP 工具采用双下划线分隔的命名空间机制，确保不同 MCP Server 的工具名不冲突：

```
mcp__{serverName}__{toolName}
```

**解析过程**：

```typescript
// 工具名解析
function parseMcpToolName(fullName: string): { server: string; tool: string } | null {
  const match = fullName.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return null;
  return { server: match[1], tool: match[2] };
}

// 示例
parseMcpToolName("mcp__confluence-mcp__confluence_search")
// → { server: "confluence-mcp", tool: "confluence_search" }
```

**MCP 工具注册流程**：

```
┌─────────────────┐      stdio/SSE     ┌─────────────────┐
│   Claude Code    │  ──────────────>   │  MCP Server      │
│                  │  tools/list        │  (confluence)    │
│                  │  <──────────────   │                  │
│                  │  [{name, schema}]  │                  │
│                  │                    └─────────────────┘
│  注册为:          │
│  mcp__confluence-mcp__confluence_search  │
│  mcp__confluence-mcp__confluence_get_content │
│  ...             │
└─────────────────┘
```

---

## 4. Vendor 依赖

Claude Code 的工具系统依赖几个关键的第三方二进制/库，这些依赖被 vendor 化（打包在发行包中），不依赖系统安装：

### 4.1 ripgrep — 高性能文件搜索

| 属性 | 说明 |
|------|------|
| **用途** | 为 `Grep` 工具提供底层搜索能力 |
| **为什么选它** | 比传统 `grep` 快 2-5 倍，原生支持 `.gitignore`、Unicode、多种编码 |
| **实现语言** | Rust |
| **vendor 方式** | 预编译二进制，按平台分发 |

**ripgrep 的核心优势**：

```
┌─────────────────────────────────────────────┐
│              搜索速度对比（示意）              │
│                                             │
│  ripgrep:  ████████░░░░░░░░░░░░░  ~0.3s    │
│  grep:     ████████████████████░░  ~1.2s    │
│  ag:       ██████████████░░░░░░░░  ~0.8s    │
│                                             │
│  （在 10 万文件的大仓库中搜索正则表达式）      │
└─────────────────────────────────────────────┘
```

- 自动跳过 `.gitignore` 中的文件（大量节省 IO）
- 内存映射文件读取，减少系统调用
- 并行搜索多个文件
- 自动检测二进制文件并跳过

### 4.2 tree-sitter-bash — Bash 命令安全解析

| 属性 | 说明 |
|------|------|
| **用途** | 为 `Bash` 工具提供命令解析能力 |
| **为什么选它** | 基于语法树分析命令结构，而非简单的字符串匹配 |
| **实现基础** | Tree-sitter 通用解析框架 + Bash 语法定义 |

**为什么需要语法级别的解析？**

简单的字符串匹配（黑名单方式）很容易被绕过：

```bash
# 字符串匹配能捕获：
rm -rf /

# 但无法捕获这些等价的变体：
r""m -rf /
$(echo rm) -rf /
eval "rm -rf /"
```

tree-sitter-bash 将命令解析为 AST（抽象语法树），能够准确识别：
- 命令的实际名称（即使经过变量展开、别名等）
- 管道链中的每个命令
- 重定向目标
- 子 shell 和 eval 中的嵌套命令

```
输入: "cat file.txt | grep 'error' > output.log"

AST:
├── pipeline
│   ├── command: "cat"
│   │   └── argument: "file.txt"
│   └── command: "grep"
│       ├── argument: "error"
│       └── redirect: "output.log"
```

### 4.3 audio-capture — 音频能力

| 属性 | 说明 |
|------|------|
| **用途** | 提供音频输入/捕获能力（如语音交互场景） |
| **特点** | 平台相关的原生模块 |

---

## 5. Edit vs Write 的设计考量

### 5.1 核心问题：Token 经济学

在 LLM 应用中，token 是最重要的成本因素之一。考虑以下场景：

> 你需要修改一个 500 行的文件中的第 200 行。

**使用 Write**：
```
需要发送的 tokens ≈ 500 行完整文件内容
```

**使用 Edit**：
```
需要发送的 tokens ≈ old_string（~1-5行）+ new_string（~1-5行）
```

**Token 消耗对比**：

```
┌─────────────────────────────────────────────────┐
│  场景：修改 500 行文件中的 1 行                    │
│                                                 │
│  Write: ██████████████████████████████  ~500 行  │
│  Edit:  ██                              ~5 行    │
│                                                 │
│  节省比例: ~99%                                   │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  场景：修改 500 行文件中的 50 行（散落在5处）       │
│                                                 │
│  Write:  ██████████████████████████████  ~500 行 │
│  Edit×5: ████████                       ~100 行  │
│                                                 │
│  节省比例: ~80%                                   │
└─────────────────────────────────────────────────┘
```

### 5.2 精确修改 vs 全量覆盖的权衡

| 维度 | Edit | Write |
|------|------|-------|
| **Token 消耗** | 低（只传 diff） | 高（传完整文件） |
| **风险** | 低（只改匹配部分） | 高（可能意外丢失内容） |
| **前置条件** | 需要知道精确的原始文本 | 需要先 Read 整个文件 |
| **适用场景** | 局部修改、bug 修复、添加几行 | 创建新文件、大规模重写 |
| **失败模式** | old_string 匹配不到 → 报错 | 覆盖错误的内容 → 无法察觉 |
| **多处修改** | 需要多次调用 | 一次搞定 |
| **幂等性** | 第二次调用会失败（old_string 已变） | 多次调用结果相同 |

### 5.3 设计决策总结

Claude Code 的系统提示中明确指导 LLM 的选择策略：

```
优先级：
1. 修改已有文件 → 使用 Edit（默认选择）
2. 创建新文件   → 使用 Write
3. 完全重写文件 → 使用 Write（但需先 Read）
4. 不确定时     → 使用 Edit（更安全）
```

这个设计体现了一个重要的工程原则：**最小变更原则**——每次操作只改变必须改变的部分，减少意外副作用。

---

## 6. 工具调用的生命周期

一次完整的工具调用经历以下 6 个阶段：

### 6.1 全流程概览

```
┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
│  注册   │ → │ 描述生成 │ → │ LLM选择 │ → │ 参数验证 │ → │ 权限检查 │ → │  执行   │
│        │   │        │   │        │   │        │   │        │   │        │
│ 启动时  │   │ 每次会话 │   │ 每轮对话 │   │ 调用前  │   │ 调用前  │   │ 调用时  │
└────────┘   └────────┘   └────────┘   └────────┘   └────────┘   └────────┘
                                                                      │
                                                                      ▼
                                                                ┌────────┐
                                                                │ 结果返回 │
                                                                │        │
                                                                │ 调用后  │
                                                                └────────┘
```

### 6.2 各阶段详解

#### 阶段 1: 注册 (Registration)

**时机**：Agent 启动时

```typescript
// 伪代码
class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    // 验证工具定义完整性
    validateToolDefinition(tool);
    // 注册到工具表
    this.tools.set(tool.name, tool);
  }
}

// 内置工具注册
registry.register(BashTool);
registry.register(ReadTool);
registry.register(WriteTool);
registry.register(EditTool);
registry.register(GlobTool);
registry.register(GrepTool);
// ... 其他内置工具

// MCP 工具动态注册
for (const server of mcpServers) {
  const tools = await server.listTools();
  for (const tool of tools) {
    registry.register({
      name: `mcp__${server.name}__${tool.name}`,
      ...tool
    });
  }
}
```

#### 阶段 2: 描述生成 (Description Generation)

**时机**：每次会话开始或工具列表变更时

```typescript
// 将工具定义转换为 LLM 可理解的格式
function generateToolDescriptions(tools: Tool[]): LLMToolSpec[] {
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,  // 详细的使用说明
      parameters: tool.inputSchema    // JSON Schema 格式的参数定义
    }
  }));
}
```

生成的描述会被注入到 API 调用的 `tools` 参数中，LLM 通过这些描述理解每个工具的用途和使用方式。

**描述质量至关重要**——好的描述直接决定 LLM 能否正确选择和使用工具。这也是为什么 Claude Code 的工具描述都非常详细，包含使用建议、限制说明和示例。

#### 阶段 3: LLM 选择 (Tool Selection)

**时机**：每轮对话中，LLM 生成响应时

LLM 基于以下信息做出选择：
1. 用户的请求意图
2. 当前对话上下文（之前的工具调用结果）
3. 可用工具的描述

```json
// LLM 输出的 tool_use 消息
{
  "type": "tool_use",
  "id": "call_abc123",
  "name": "Grep",
  "input": {
    "pattern": "TODO|FIXME|HACK",
    "path": "/project/src",
    "include": "*.ts"
  }
}
```

**LLM 也可能在一次响应中选择多个工具**（并行调用），前提是这些调用之间没有依赖关系。

#### 阶段 4: 参数验证 (Input Validation)

**时机**：收到 LLM 的工具调用请求后，执行前

```typescript
function validateInput(tool: Tool, input: unknown): void {
  // 1. 类型检查：参数是否为对象
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError("参数必须是对象");
  }

  // 2. 必填检查：required 字段是否都存在
  for (const field of tool.parameters.required || []) {
    if (!(field in input)) {
      throw new ValidationError(`缺少必填参数: ${field}`);
    }
  }

  // 3. 类型检查：每个字段的类型是否匹配
  for (const [key, value] of Object.entries(input)) {
    const schema = tool.parameters.properties[key];
    if (!schema) {
      throw new ValidationError(`未知参数: ${key}`);
    }
    if (!matchesType(value, schema.type)) {
      throw new ValidationError(`参数 ${key} 类型错误`);
    }
  }
}
```

#### 阶段 5: 权限检查 (Permission Check)

**时机**：参数验证通过后，执行前

```typescript
async function checkPermission(
  tool: Tool,
  input: Record<string, unknown>,
  context: PermissionContext
): Promise<PermissionResult> {

  // 只读工具通常不需要确认
  if (tool.isReadOnly) return { allowed: true };

  // 检查是否有预授权规则
  const preAuth = context.checkPreAuthorized(tool.name, input);
  if (preAuth) return { allowed: true };

  // 检查 CLAUDE.md 中的权限配置
  const configAuth = context.checkConfigPermission(tool.name);
  if (configAuth !== undefined) return { allowed: configAuth };

  // 需要用户确认
  return {
    allowed: false,
    requiresConfirmation: true,
    message: `工具 ${tool.name} 需要执行以下操作，是否允许？`
  };
}
```

权限检查是 Claude Code 安全模型的核心，详见 [05-permission-system.md](./05-permission-system.md)。

#### 阶段 6: 执行 (Execution)

**时机**：权限检查通过后

```typescript
async function executeTool(
  tool: Tool,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    // 执行工具的具体逻辑
    const result = await tool.execute(input);

    return {
      type: "tool_result",
      tool_use_id: callId,
      content: result,
      is_error: false,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: callId,
      content: `Error: ${error.message}`,
      is_error: true,
      duration: Date.now() - startTime
    };
  }
}
```

#### 结果返回 (Result Return)

**时机**：执行完成后

执行结果以 `tool_result` 消息的形式追加到对话历史中，供 LLM 在下一轮推理中参考：

```json
{
  "role": "tool",
  "tool_use_id": "call_abc123",
  "content": [
    {
      "type": "text",
      "text": "src/index.ts:42: // TODO: 实现缓存机制\nsrc/utils.ts:15: // FIXME: 这里有竞态条件\n..."
    }
  ]
}
```

LLM 收到结果后，可以：
1. **继续调用工具**：根据结果决定下一步操作
2. **生成最终回复**：整合所有工具结果，回答用户
3. **调整策略**：工具失败时尝试替代方案

### 6.3 完整时序图

```
用户                   Agent 框架                  LLM (Claude)             工具实现
 │                        │                          │                       │
 │  "找到所有TODO"         │                          │                       │
 │ ─────────────────────> │                          │                       │
 │                        │   messages + tools spec  │                       │
 │                        │ ───────────────────────> │                       │
 │                        │                          │                       │
 │                        │   tool_use: Grep(TODO)   │                       │
 │                        │ <─────────────────────── │                       │
 │                        │                          │                       │
 │                        │── 参数验证 ──┐             │                       │
 │                        │             │             │                       │
 │                        │<─ 验证通过 ──┘             │                       │
 │                        │                          │                       │
 │                        │── 权限检查 ──┐             │                       │
 │                        │             │             │                       │
 │  "允许执行 Grep？"     │<─ 需要确认 ──┘             │                       │
 │ <───────────────────── │                          │                       │
 │  "允许"                │                          │                       │
 │ ─────────────────────> │                          │                       │
 │                        │                          │                       │
 │                        │   execute(Grep, {TODO})  │                       │
 │                        │ ─────────────────────────────────────────────────>│
 │                        │                          │                       │
 │                        │   result: [匹配结果...]    │                       │
 │                        │ <─────────────────────────────────────────────────│
 │                        │                          │                       │
 │                        │   tool_result + messages  │                       │
 │                        │ ───────────────────────> │                       │
 │                        │                          │                       │
 │                        │   "我找到了12处TODO..."    │                       │
 │                        │ <─────────────────────── │                       │
 │                        │                          │                       │
 │  "我找到了12处TODO..."  │                          │                       │
 │ <───────────────────── │                          │                       │
```

---

## 总结

Claude Code 的工具系统是整个 Agent 架构的**执行引擎**。它的设计核心可以归纳为：

1. **声明式定义**：每个工具通过 JSON Schema 声明接口，实现 LLM 理解与运行时验证的统一
2. **分层安全**：参数验证 → 权限检查 → 沙箱执行，三层防护确保安全
3. **Token 效率**：Edit 优先于 Write 的策略，最大限度降低 token 消耗
4. **可扩展性**：MCP 命名空间机制让第三方工具可以无限扩展，同时不与内置工具冲突
5. **组合式设计**：简单的原子工具通过 Agent Loop 的多轮调用，组合出复杂的操作能力

工具系统与 [03-agentic-loop.md](./03-agentic-loop.md) 中的 Agent Loop 紧密配合，与 [05-permission-system.md](./05-permission-system.md) 中的权限系统形成制衡，共同构成了 Claude Code 的核心执行能力。
