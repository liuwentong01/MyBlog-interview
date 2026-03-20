# Plugin System & Hooks 学习笔记

> 本文围绕 AI Agent（以 Claude Code 为代表）的插件系统、Hooks 机制、沙箱安全模型以及其他关键子系统进行深入分析。

---

## Part 1: 插件系统 (Plugin System)

### 1. 插件架构

#### 1.1 Marketplace 插件市场管理

插件系统的核心是一个**中心化的插件市场（Marketplace）**，它负责：

- **插件发现**：用户可以浏览、搜索可用插件
- **版本管理**：每个插件有语义化版本号，支持版本约束（如 `^1.0.0`）
- **元数据托管**：插件的名称、描述、作者、依赖、权限声明等信息
- **分发与下载**：提供插件包的下载与安装渠道

```
┌─────────────────────────────────────┐
│           Plugin Marketplace        │
│  ┌──────┐ ┌──────┐ ┌──────┐       │
│  │PlugA │ │PlugB │ │PlugC │ ...   │
│  └──┬───┘ └──┬───┘ └──┬───┘       │
│     │        │        │            │
│  metadata  metadata  metadata      │
│  version   version   version       │
└─────────────┬───────────────────────┘
              │ install / update
              ▼
┌─────────────────────────────────────┐
│         Local Plugin Manager        │
│  - 安装/卸载/启用/禁用/更新         │
│  - 依赖解析                         │
│  - 配置管理                         │
└─────────────────────────────────────┘
```

#### 1.2 通过 MCP 协议通信

插件与 Agent 之间并不直接耦合，而是通过 **MCP（Model Context Protocol）** 协议进行通信：

- 每个插件本质上是一个 **MCP Server**
- Agent 作为 **MCP Client** 与插件交互
- 通信方式支持：**stdio**（本地进程）、**SSE**（HTTP 流）、**WebSocket**

```
Agent (MCP Client)
    │
    ├── stdio ──► Plugin A (MCP Server, 本地进程)
    │
    ├── SSE ────► Plugin B (MCP Server, 远程 HTTP)
    │
    └── WS ─────► Plugin C (MCP Server, WebSocket)
```

MCP 协议定义了标准的消息格式（基于 JSON-RPC 2.0）：

```json
// 请求：调用插件提供的工具
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "confluence_search",
    "arguments": { "query": "项目文档" }
  }
}

// 响应
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "搜索结果..." }
    ]
  }
}
```

#### 1.3 安装/卸载/启用/禁用/更新 生命周期

插件有完整的生命周期管理：

```
  [未安装]
     │
     │ install
     ▼
  [已安装/已启用] ◄──── enable ──── [已安装/已禁用]
     │       │                            ▲
     │       │ disable                    │
     │       └────────────────────────────┘
     │
     │ update (下载新版本 → 替换 → 重启 MCP Server)
     ▼
  [已更新/已启用]
     │
     │ uninstall (停止进程 → 清理文件 → 移除配置)
     ▼
  [未安装]
```

每个生命周期阶段对应的操作：

| 阶段 | 操作 |
|------|------|
| **install** | 下载插件包 → 解压 → 注册到配置文件 → 启动 MCP Server 进程 |
| **enable** | 启动 MCP Server → 注册工具/命令/资源到 Agent |
| **disable** | 停止 MCP Server 进程 → 从 Agent 注销工具/命令/资源（配置保留）|
| **update** | 停止旧版本 → 下载新版本 → 替换 → 启动新版本 |
| **uninstall** | 停止进程 → 删除文件 → 从配置中移除 |

#### 1.4 插件作用域：user / project / local

插件的安装和生效范围分为三个层级：

```
优先级（从高到低）：
┌──────────────────────────────────────┐
│  local   (.claude/settings.local.json) │  ← 仅本机当前项目，不提交到 git
├──────────────────────────────────────┤
│  project (.claude/settings.json)       │  ← 项目级，跟随 git 仓库共享给团队
├──────────────────────────────────────┤
│  user    (~/.claude/settings.json)     │  ← 用户全局配置，所有项目共享
└──────────────────────────────────────┘
```

- **user 级别**：安装在 `~/.claude/` 下，对当前用户的所有项目生效。适合通用工具类插件（如日历、翻译、笔记等）。
- **project 级别**：配置在项目根目录 `.claude/settings.json`，提交到版本控制，团队成员共享。适合项目特定的插件（如 Confluence 集成、JIRA 工具等）。
- **local 级别**：配置在 `.claude/settings.local.json`，不提交到 git，仅对当前开发者的本地环境生效。适合个人偏好或实验性插件。

配置示例：

```json
// ~/.claude/settings.json (user 级别)
{
  "mcpServers": {
    "memory-plugin": {
      "command": "npx",
      "args": ["@anthropic/memory-mcp"],
      "scope": "user"
    }
  }
}

// .claude/settings.json (project 级别)
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": ["./AI/mcp/confluence-mcp/dist/index.js"],
      "env": {
        "CONFLUENCE_URL": "https://wiki.example.com"
      }
    }
  }
}
```

---

### 2. 插件的扩展能力

插件通过 MCP 协议可以向 Agent 提供四种核心扩展能力：

#### 2.1 添加新工具（Tools）

工具是最常见的扩展方式，让 Agent 能够执行新的操作：

```typescript
// 插件端注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "confluence_search",
      description: "搜索 Confluence 文档",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" }
        },
        required: ["query"]
      }
    },
    {
      name: "confluence_create_page",
      description: "创建 Confluence 页面",
      inputSchema: {
        type: "object",
        properties: {
          spaceKey: { type: "string" },
          title: { type: "string" },
          content: { type: "string" }
        },
        required: ["spaceKey", "title", "content"]
      }
    }
  ]
}));
```

Agent 在对话中会自动发现并使用这些工具：

```
用户：帮我在 Confluence 上搜索关于部署流程的文档
Agent：（自动调用 confluence_search 工具）
→ 找到 3 篇相关文档...
```

#### 2.2 添加新命令（Prompts）

插件可以注册预定义的 Prompt 模板，用户可以通过斜杠命令触发：

```typescript
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "code-review",
      description: "对代码进行审查",
      arguments: [
        { name: "file", description: "要审查的文件路径", required: true }
      ]
    }
  ]
}));
```

#### 2.3 提供数据源（Resources）

Resources 让插件暴露可读取的数据，Agent 可以按需获取上下文：

```typescript
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "confluence://spaces/DEV/pages",
      name: "开发团队文档",
      mimeType: "text/plain"
    },
    {
      uri: "jira://project/PROJ/issues",
      name: "当前项目 Issues",
      mimeType: "application/json"
    }
  ]
}));
```

#### 2.4 自定义行为

通过组合以上能力，插件可以实现复杂的自定义行为：

- **工作流自动化**：如 "创建 PR → 更新 JIRA → 通知 Slack"
- **代码生成**：基于数据库 Schema 自动生成 TypeScript 类型
- **环境管理**：自动配置开发环境、启动依赖服务
- **监控集成**：查询线上错误日志、性能指标

---

### 3. 插件安全模型

#### 3.1 插件隔离

每个插件运行在独立的进程中，与 Agent 主进程和其他插件之间相互隔离：

```
┌──────────────────────────────────────────┐
│              Agent 主进程                 │
│  ┌──────────────────────────────────┐    │
│  │          MCP Client              │    │
│  │  ┌─────┐  ┌─────┐  ┌─────┐     │    │
│  │  │Conn1│  │Conn2│  │Conn3│     │    │
│  └──┴──┬──┴──┴──┬──┴──┴──┬──┴─────┘    │
└────────┼────────┼────────┼───────────────┘
  进程边界│ 进程边界│ 进程边界│
         ▼        ▼        ▼
    ┌────────┐┌────────┐┌────────┐
    │Plugin A││Plugin B││Plugin C│
    │(进程1) ││(进程2) ││(进程3) │
    └────────┘└────────┘└────────┘
```

隔离保证：
- **内存隔离**：插件崩溃不会影响 Agent 或其他插件
- **故障隔离**：一个插件挂起不会阻塞其他插件的调用
- **资源隔离**：每个插件进程有独立的资源配额

#### 3.2 权限继承

插件的权限遵循**最小权限原则**，并从配置层级继承：

```
user 配置允许的权限集合
         │
         ▼ 取交集
project 配置允许的权限集合
         │
         ▼ 取交集
local 配置允许的权限集合
         │
         ▼
   插件实际获得的权限
```

权限类型包括：
- **文件系统访问**：限定可读写的目录范围
- **网络访问**：限定可访问的域名/IP
- **环境变量**：控制插件能读取的环境变量
- **子进程**：是否允许插件创建子进程

配置示例：

```json
{
  "mcpServers": {
    "risky-plugin": {
      "command": "npx",
      "args": ["risky-plugin-mcp"],
      "env": {
        "API_KEY": "xxx"  // 仅传递必要的环境变量
      }
    }
  },
  "permissions": {
    "risky-plugin": {
      "allowedPaths": ["/tmp/risky-plugin/"],
      "allowedDomains": ["api.example.com"],
      "allowSubprocess": false
    }
  }
}
```

#### 3.3 信任链

插件的信任建立在多层验证之上：

```
1. 来源验证
   └── 插件是否来自官方 Marketplace？
       └── 是 → 基础信任
       └── 否（本地/自定义）→ 需要用户显式授权

2. 权限声明
   └── 插件声明了哪些权限需求？
       └── 首次使用时提示用户确认

3. 运行时验证
   └── 每次工具调用是否在允许范围内？
       └── 是 → 执行
       └── 否 → 拒绝并报错

4. 用户确认
   └── 敏感操作是否需要用户逐次确认？
       └── allowedTools 白名单配置可跳过确认
```

信任配置示例：

```json
{
  "allowedTools": [
    "confluence_search",       // 允许搜索，无需确认
    "confluence_get_content"   // 允许读取，无需确认
    // confluence_create_page 未列出 → 每次需要确认
  ]
}
```

---

## Part 2: Hooks 系统

### 4. Hooks 的作用

Hooks 允许用户在 Agent 执行特定操作的前后，自动运行**自定义 shell 命令**。它的设计思想与以下系统类似：

| 系统 | Hook 类型 | 触发方式 |
|------|-----------|----------|
| **Git Hooks** | pre-commit、post-merge 等 | Git 操作前后自动执行脚本 |
| **Webpack Plugin** | compilation、emit 等 | Webpack 编译生命周期中的 tapable hooks |
| **AI Agent Hooks** | pre-tool、post-tool 等 | Agent 工具调用前后执行 shell 命令 |

核心理念是一样的：**在系统的关键节点插入用户自定义逻辑，而不修改系统本身**。

```
类比 Webpack 的 tapable 机制：

Webpack:
  compiler.hooks.emit.tap('MyPlugin', (compilation) => { ... })

Agent Hooks:
  "pre-tool": { "Bash": "echo '即将执行 Bash 命令'" }

本质上都是「事件驱动 + 回调注入」模式
```

---

### 5. 触发时机

Agent 定义了以下 Hook 触发点：

```
用户输入
  │
  ├─► [user-prompt-submit]    // 用户提交 prompt 时
  │
  ▼
Agent 初始化
  │
  ├─► [init]                  // Agent 初始化完成时（首次启动）
  ├─► [SessionStart]          // 每次会话开始时
  │
  ▼
Agent 推理 → 决定调用工具
  │
  ├─► [pre-tool]              // 工具调用前
  │     │
  │     ▼
  │   执行工具（Bash, Read, Write, Edit...）
  │     │
  │     ▼
  ├─► [post-tool]             // 工具调用后
  │
  ▼
Agent 继续推理或返回结果
```

各 Hook 详细说明：

#### 5.1 pre-tool（工具调用前）

在 Agent 调用任何工具之前执行。常见用途：
- 参数校验 / 拦截危险操作
- 日志记录
- 环境准备

环境变量注入：
- `$TOOL_NAME`：即将调用的工具名
- `$TOOL_INPUT`：工具的输入参数（JSON 字符串）

#### 5.2 post-tool（工具调用后）

在工具执行完成后执行。常见用途：
- 自动格式化代码（Write/Edit 之后）
- 自动运行测试
- 清理临时文件

环境变量注入：
- `$TOOL_NAME`：刚执行的工具名
- `$TOOL_INPUT`：工具的输入参数
- `$TOOL_OUTPUT`：工具的输出结果

#### 5.3 user-prompt-submit（用户提交输入时）

用户发送消息给 Agent 时触发。可用于：
- 记录用户请求日志
- 预处理/验证用户输入
- 通知外部系统

#### 5.4 init（初始化时）

Agent 首次启动时触发一次。可用于：
- 检查环境依赖
- 拉取最新配置
- 启动辅助服务

#### 5.5 SessionStart（会话开始时）

每次新会话开始时触发（包括 `--continue` 恢复的会话）。可用于：
- 加载项目上下文
- 设置会话级环境变量
- 同步外部状态

---

### 6. Hooks 配置方式

#### 6.1 在 settings.json 中配置

Hooks 配置在与插件相同的 settings 文件中，支持三个作用域层级：

```json
// ~/.claude/settings.json (全局 Hooks)
// .claude/settings.json (项目 Hooks)
// .claude/settings.local.json (本地 Hooks)
```

#### 6.2 配置格式

```json
{
  "hooks": {
    "<hook-event>": {
      "<matcher>": "<shell-command>"
    }
  }
}
```

- `<hook-event>`：触发时机，如 `pre-tool`、`post-tool` 等
- `<matcher>`：匹配条件。对于工具相关的 hook，值为工具名（如 `Bash`、`Write`）；通用 hook 用 `*`
- `<shell-command>`：要执行的 shell 命令

#### 6.3 完整配置示例

```json
{
  "hooks": {
    "pre-tool": {
      "Bash": "echo \"[$(date)] pre-tool: Bash with input: $TOOL_INPUT\" >> /tmp/agent-hooks.log"
    },
    "post-tool": {
      "Write": "cd /Users/liuwentong/Code/R && npx prettier --write \"$TOOL_INPUT\" 2>/dev/null || true",
      "Edit": "cd /Users/liuwentong/Code/R && npx prettier --write \"$TOOL_INPUT\" 2>/dev/null || true"
    },
    "user-prompt-submit": {
      "*": "echo \"[$(date)] User submitted prompt\" >> /tmp/agent-activity.log"
    },
    "init": {
      "*": "echo '环境检查完成' && node --version && npm --version"
    }
  }
}
```

#### 6.4 常见用例

**用例 1：自动格式化（post-tool）**

每次 Agent 写入或编辑文件后，自动运行 Prettier 格式化：

```json
{
  "hooks": {
    "post-tool": {
      "Write": "prettier --write \"$TOOL_INPUT\"",
      "Edit": "prettier --write \"$TOOL_INPUT\""
    }
  }
}
```

**用例 2：自动测试（post-tool）**

每次修改文件后，自动运行相关测试：

```json
{
  "hooks": {
    "post-tool": {
      "Write": "npm test -- --findRelatedTests \"$TOOL_INPUT\" 2>/dev/null || true",
      "Edit": "npm test -- --findRelatedTests \"$TOOL_INPUT\" 2>/dev/null || true"
    }
  }
}
```

**用例 3：操作通知（post-tool）**

重要操作完成后发送通知：

```json
{
  "hooks": {
    "post-tool": {
      "Bash": "if echo \"$TOOL_INPUT\" | grep -q 'git push'; then osascript -e 'display notification \"代码已推送\" with title \"Agent\"'; fi"
    }
  }
}
```

**用例 4：安全拦截（pre-tool）**

阻止危险操作：

```json
{
  "hooks": {
    "pre-tool": {
      "Bash": "if echo \"$TOOL_INPUT\" | grep -qE 'rm -rf /|sudo'; then echo 'BLOCKED: 危险命令' >&2; exit 1; fi"
    }
  }
}
```

> 注意：当 pre-tool hook 以非零退出码结束时，工具调用会被阻止。

---

### 7. Hooks vs 插件的区别

| 维度 | Hooks | 插件（Plugin） |
|------|-------|----------------|
| **本质** | Shell 脚本片段 | 完整的 MCP Server 进程 |
| **通信协议** | 无（直接执行 shell 命令） | MCP 协议（JSON-RPC 2.0） |
| **复杂度** | 低（一行 shell 即可） | 高（需要实现 MCP Server） |
| **能力范围** | 仅在特定时机执行命令 | 添加工具/命令/资源，完整扩展 |
| **状态管理** | 无状态（每次独立执行） | 有状态（常驻进程，可维护内存/连接） |
| **交互方式** | 单向（执行并退出） | 双向（Agent 可调用，插件可返回结果） |
| **适用场景** | 格式化、日志、简单校验 | 第三方集成、复杂工作流、数据源 |
| **启动开销** | 极低（fork shell） | 较高（启动进程、建立连接） |

**选择建议：**

```
需求分析
  │
  ├─ 只需在某个时机执行简单命令？
  │   └─► 使用 Hooks
  │       例：自动格式化、日志记录、简单校验
  │
  ├─ 需要让 Agent 能调用新的工具？
  │   └─► 使用插件
  │       例：搜索 Confluence、创建 JIRA issue
  │
  ├─ 需要维护状态或长连接？
  │   └─► 使用插件
  │       例：数据库连接池、WebSocket 监听
  │
  └─ 需要提供数据源给 Agent 参考？
      └─► 使用插件
          例：项目文档索引、API 文档
```

---

## Part 3: 沙箱 (Sandbox)

### 8. Bash 工具沙箱

Agent 执行 Bash 命令时，默认运行在一个**受限沙箱**环境中，以防止恶意或意外的破坏性操作。

#### 8.1 限制网络访问

沙箱默认禁止或限制网络访问：

```
┌──────────────────────────────┐
│         Sandbox              │
│                              │
│  curl https://evil.com  ✗   │  ← 网络请求被拦截
│  wget http://data.io    ✗   │
│  npm install             ✗   │  ← 需要网络的操作被限制
│                              │
│  cat /etc/hosts          ✓   │  ← 本地读取允许
│  node script.js          ✓   │  ← 本地执行允许
│                              │
└──────────────────────────────┘
```

目的：防止 Agent 被 Prompt Injection 攻击时泄露敏感信息到外部服务器。

#### 8.2 限制文件系统访问

沙箱将文件系统访问限制在项目目录及必要的系统路径内：

```
允许访问：
  ✓ /Users/liuwentong/Code/R/          (项目目录)
  ✓ /tmp/                              (临时文件)
  ✓ /usr/bin/, /usr/local/bin/         (系统工具)
  ✓ ~/.claude/                         (Agent 配置)

禁止访问：
  ✗ /Users/liuwentong/.ssh/            (SSH 密钥)
  ✗ /Users/liuwentong/.aws/            (AWS 凭证)
  ✗ /etc/shadow                        (系统密码)
  ✗ 其他用户的 home 目录
```

#### 8.3 --dangerously-skip-permissions 跳过沙箱

当用户明确需要完整权限时，可以跳过沙箱限制：

```bash
# 跳过所有权限检查（危险！）
claude --dangerously-skip-permissions

# 使用场景：
# - CI/CD 环境中运行（已有其他安全措施）
# - 需要网络访问（npm install, git push 等）
# - 调试 Agent 行为
```

> **警告**：跳过权限检查意味着 Agent 执行的任何命令都不会被拦截，包括潜在的破坏性操作。仅在可信环境中使用。

#### 8.4 沙箱实现原理

在 macOS 上，沙箱基于 Apple 的 **Seatbelt** (sandbox-exec) 机制：

```
Agent 进程
  │
  │  fork + exec
  ▼
┌─────────────────────────────────────────┐
│  sandbox-exec -p '<sandbox-profile>'    │
│                                         │
│  沙箱配置文件定义：                      │
│  (version 1)                            │
│  (deny default)           ; 默认拒绝所有│
│  (allow file-read*                      │
│    (subpath "/Users/.../project"))       │
│  (allow file-write*                     │
│    (subpath "/Users/.../project"))       │
│  (allow process-exec                    │
│    (subpath "/usr/bin"))                 │
│  (deny network-outbound)  ; 禁止出站网络│
│                                         │
│  └── bash -c "用户的命令"               │
└─────────────────────────────────────────┘
```

在 Linux 上，可能使用以下机制之一：
- **seccomp-bpf**：系统调用级别的过滤
- **namespaces + cgroups**：容器级别的隔离
- **AppArmor / SELinux**：强制访问控制

核心思路都是：**白名单策略，默认拒绝，仅允许明确列出的操作**。

---

## Part 4: 其他子系统

### 9. 远程控制

#### 9.1 claude.ai/code 远程控制

Agent 支持通过 Web 界面远程操控本地运行的 Claude Code 实例：

```
┌─────────────────────┐        ┌──────────────────────┐
│  claude.ai/code     │        │  本地 Claude Code     │
│  (Web 浏览器)        │◄──────►│  (CLI 进程)           │
│                     │  WS/SSE│                      │
│  远程发送指令        │        │  本地执行操作          │
│  查看执行结果        │        │  返回结果              │
└─────────────────────┘        └──────────────────────┘
```

#### 9.2 WebSocket / SSE 传输

远程控制的通信基于两种传输方式：

- **WebSocket**：全双工实时通信，适合交互式场景
- **SSE (Server-Sent Events)**：单向推送，适合状态更新流

```
WebSocket 模式：
  浏览器 ←──双向──► Agent
  - 发送用户输入
  - 接收 Agent 输出（流式）
  - 接收工具调用请求/结果

SSE 模式：
  浏览器 ──POST──► Agent (发送指令)
  浏览器 ◄──SSE───  Agent (推送事件流)
```

#### 9.3 Bridge 模式

Bridge 模式是远程控制的核心架构，它在本地 Agent 和远程客户端之间建立桥接：

```
┌─────────────────────────────────────────────┐
│                  Cloud                       │
│  ┌─────────────────────────────────────┐    │
│  │        Relay Server                  │    │
│  │  (WebSocket 中继 / 消息路由)         │    │
│  └──────┬────────────────┬──────────────┘    │
│         │                │                   │
└─────────┼────────────────┼───────────────────┘
          │                │
    ┌─────▼─────┐    ┌────▼──────┐
    │  Web 客户端 │    │ 本地 Agent │
    │ (浏览器)    │    │ (Bridge)  │
    │            │    │           │
    │ 用户界面    │    │ 执行引擎   │
    └────────────┘    └───────────┘
```

Bridge 模式的优势：
- **NAT 穿透**：通过云端中继，无需本地暴露端口
- **安全性**：通信经过加密和认证
- **体验**：Web 界面提供更丰富的交互（如文件预览、diff 视图）

---

### 10. Auto Memory

#### 10.1 存储位置

Agent 的自动记忆存储在用户目录下：

```
~/.claude/
  └── projects/
      └── <project-hash>/
          └── memory/
              ├── MEMORY.md          # 主记忆文件
              ├── session-xxx.md     # 会话记忆快照（可选）
              └── ...
```

每个项目通过路径 hash 区分，避免命名冲突。

#### 10.2 MEMORY.md 自动加载

每次 Agent 启动新会话时，会自动加载项目对应的 `MEMORY.md` 作为上下文：

```
会话开始
  │
  ├─► 加载 ~/.claude/settings.json
  ├─► 加载 .claude/settings.json
  ├─► 加载 CLAUDE.md（项目指令）
  ├─► 加载 MEMORY.md（自动记忆）     ◄── 这里
  │
  ▼
Agent 已具备项目上下文，开始对话
```

MEMORY.md 的内容通常包括：

```markdown
# Project Memory

## 项目架构
- 前端：React + TypeScript
- 后端：Node.js + Express
- 数据库：PostgreSQL

## 重要约定
- API 路径前缀 /api/v2
- 组件使用 PascalCase 命名
- 所有 API 响应包装在 { data, error, meta } 结构中

## 已知问题
- build 脚本在 Node 18 以下有兼容性问题
- test:e2e 需要先启动 docker-compose

## 最近变更
- 2026-03-18: 迁移到 ESM 模块系统
- 2026-03-15: 升级 React 到 v19
```

#### 10.3 跨会话记忆

Auto Memory 的核心价值是**跨会话持久化**：

```
会话 1:
  用户："这个项目用的是 pnpm，不要用 npm"
  Agent：（记录到 MEMORY.md）

会话 2（新会话）:
  用户："安装一个新依赖"
  Agent：（从 MEMORY.md 读取 → 使用 pnpm add）
```

记忆的写入触发方式：
- **显式**：用户说 "记住这个" 或 "以后都这样做"
- **隐式**：Agent 发现重要的项目模式或约定时，主动提议记录
- **自动**：某些关键信息（如报错和解决方案）自动归档

---

### 11. Thinking 模式

Agent 支持配置不同的思考模式，控制推理的深度和可见性：

#### 11.1 adaptive（自适应模式）

```json
{ "thinking": "adaptive" }
```

- **默认模式**
- Agent 根据问题复杂度自动决定是否进行深度推理
- 简单问题（如 "帮我格式化这个文件"）→ 直接执行，无需深度思考
- 复杂问题（如 "重构这个模块的架构"）→ 自动启用 extended thinking

```
用户输入 → 复杂度评估
              │
              ├─ 低复杂度 → 直接响应
              │
              └─ 高复杂度 → Extended Thinking
                              │
                              ├─ 分析问题
                              ├─ 制定方案
                              ├─ 评估风险
                              └─ 输出结果
```

#### 11.2 disabled（关闭模式）

```json
{ "thinking": "disabled" }
```

- 完全关闭 extended thinking
- Agent 直接生成响应，不进行显式推理步骤
- 优势：响应更快、token 消耗更少
- 劣势：复杂问题的解决质量可能下降

#### 11.3 Extended Thinking API 能力

Extended Thinking 是 Claude 模型的核心能力之一：

```
普通模式：
  Prompt → [模型推理（不可见）] → Response

Extended Thinking 模式：
  Prompt → [Thinking（可见的推理过程）] → Response
           ┌──────────────────────────┐
           │ 1. 分析用户需求           │
           │ 2. 考虑多种实现方案       │
           │ 3. 评估每种方案的利弊     │
           │ 4. 选择最优方案           │
           │ 5. 规划实现步骤           │
           └──────────────────────────┘
```

Extended Thinking 的技术特点：

- **思考预算（budget_tokens）**：可以配置最大思考 token 数，控制推理深度
- **思考可见性**：thinking 内容在 API 响应中以 `thinking` 字段返回，用户可以查看
- **流式输出**：thinking 过程支持流式传输，用户可以实时看到推理过程
- **思考与工具调用结合**：Agent 可以在 thinking 阶段规划工具调用策略，然后在响应阶段执行

```typescript
// Extended Thinking API 调用示例
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000  // 最多用 10000 tokens 进行思考
  },
  messages: [
    { role: "user", content: "重构这个模块的错误处理逻辑" }
  ]
});

// 响应结构
// response.content = [
//   { type: "thinking", thinking: "让我分析一下当前的错误处理..." },
//   { type: "text", text: "我建议以下重构方案：..." }
// ]
```

---

## 总结：架构全景图

```
┌─────────────────────────────────────────────────────────────┐
│                        AI Agent 系统                         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Thinking │  │  Memory  │  │  Hooks   │  │  Sandbox │   │
│  │  Engine  │  │  System  │  │  System  │  │  Engine  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │             │              │          │
│  ┌────▼──────────────▼─────────────▼──────────────▼─────┐   │
│  │                   Agent Core                          │   │
│  │  (推理循环 + 工具调度 + 上下文管理)                    │   │
│  └────┬──────────────┬─────────────┬────────────────────┘   │
│       │              │             │                         │
│  ┌────▼─────┐  ┌────▼─────┐  ┌───▼──────┐                 │
│  │Built-in  │  │  Plugin  │  │  Remote  │                 │
│  │ Tools    │  │  System  │  │  Bridge  │                 │
│  │(Bash,    │  │ (MCP)    │  │ (WS/SSE) │                 │
│  │Read,     │  │          │  │          │                 │
│  │Write...) │  │ ┌──┐┌──┐│  │          │                 │
│  └──────────┘  │ │P1││P2││  └──────────┘                 │
│                │ └──┘└──┘│                                │
│                └─────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

各子系统协作关系：

1. **Thinking Engine** 负责推理决策，决定使用哪些工具
2. **Memory System** 提供跨会话持久化上下文
3. **Hooks System** 在关键节点注入用户自定义逻辑
4. **Sandbox Engine** 确保工具执行的安全性
5. **Plugin System** 通过 MCP 协议扩展 Agent 能力
6. **Remote Bridge** 支持远程控制和 Web 界面交互
