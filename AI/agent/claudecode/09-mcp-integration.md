# 09 - MCP 协议集成

## 1. MCP 协议介绍

### 1.1 什么是 MCP（Model Context Protocol）

MCP（Model Context Protocol）是 Anthropic 提出的一个**开放标准协议**，用于规范 LLM 应用与外部工具/数据源之间的通信方式。它定义了一套标准化的接口，让 AI 模型能够安全、可控地访问外部资源、调用工具、执行操作。

核心理念：**LLM 不再是孤立的文本生成器，而是可以通过标准化协议与整个外部世界交互的智能体。**

```
┌─────────────────────────────────────────────────────┐
│                   AI 应用 (Host)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ MCP      │  │ MCP      │  │ MCP      │          │
│  │ Client 1 │  │ Client 2 │  │ Client 3 │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
└───────┼──────────────┼──────────────┼────────────────┘
        │              │              │
   ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐
   │ MCP      │  │ MCP      │  │ MCP      │
   │ Server A │  │ Server B │  │ Server C │
   │ (数据库)  │  │ (文档)    │  │ (API)    │
   └──────────┘  └──────────┘  └──────────┘
```

### 1.2 为什么需要标准化的协议

在 MCP 出现之前，每个 AI 应用接入外部工具/服务的方式都是各自为政的：

| 问题 | 描述 |
|------|------|
| **碎片化** | 每个工具需要为每个 AI 平台写不同的集成代码 |
| **重复造轮子** | OpenAI Function Calling、LangChain Tools、各种 Plugin 系统互不兼容 |
| **安全隐患** | 缺乏统一的权限控制和沙箱机制 |
| **维护成本高** | N 个工具 x M 个平台 = N*M 种集成方式 |

MCP 的出现将这个 N*M 问题简化为 N+M：

```
Before MCP:                          After MCP:
┌──────┐ ─── 定制集成 ──→ ┌──────┐   ┌──────┐ ─── MCP ──→ ┌──────┐
│ App1 │ ─── 定制集成 ──→ │Tool1 │   │ App1 │ ─── MCP ──→ │Tool1 │
│      │ ─── 定制集成 ──→ │Tool2 │   │      │ ─── MCP ──→ │Tool2 │
│      │ ─── 定制集成 ──→ │Tool3 │   │      │              │Tool3 │
└──────┘                  └──────┘   └──────┘              └──────┘
┌──────┐ ─── 定制集成 ──→ ┌──────┐   ┌──────┐ ─── MCP ──→
│ App2 │ ─── 定制集成 ──→ │Tool1 │   │ App2 │ ─── MCP ──→ (同上)
│      │ ─── 定制集成 ──→ │Tool2 │   │      │ ─── MCP ──→
└──────┘                  └──────┘   └──────┘
```

### 1.3 MCP 的设计目标

1. **标准化接入** —— 所有工具/服务通过统一协议暴露能力
2. **安全可控** —— 内置权限模型，支持工具级别的访问控制
3. **可发现性** —— 工具可以动态注册和发现，LLM 能够"看到"可用的能力
4. **传输无关** —— 不绑定特定传输层，支持 stdio、Streamable HTTP 等
5. **语言无关** —— 任何编程语言都可以实现 MCP Server/Client

### 1.4 类比理解

> **USB 协议之于外设，MCP 之于 AI 工具。**

| 类比维度 | USB | MCP |
|----------|-----|-----|
| 连接对象 | 电脑 ↔ 外设 | AI 应用 ↔ 外部工具 |
| 标准化价值 | 不再需要为每种外设设计专用接口 | 不再需要为每个 AI 平台写定制集成 |
| 即插即用 | 插入USB设备自动识别 | 启动 MCP Server 即可被 AI 发现 |
| 多设备支持 | 一个USB口支持键盘、鼠标、U盘... | 一个 MCP 客户端连接多个 Server |
| 协议层级 | 物理层 + 数据层 + 应用层 | 传输层 + JSON-RPC + 能力协商 |

---

## 2. Claude Code 中的 MCP 架构

Claude Code 作为一个 CLI Agent 系统，天然支持 MCP 协议。它既可以作为 MCP 的 **Host**（连接外部 MCP Server），也通过内置机制暴露 MCP 能力。

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Claude Code (Host)                        │
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│  │  Agentic     │   │  Tool       │   │  Permission  │       │
│  │  Loop        │──→│  System     │──→│  System      │       │
│  └──────┬──────┘   └──────┬──────┘   └──────────────┘       │
│         │                  │                                  │
│         │   ┌──────────────┼──────────────────┐              │
│         │   │         MCP Manager             │              │
│         │   │                                 │              │
│         │   │  ┌──────────┐ ┌──────────┐     │              │
│         │   │  │ Client 1 │ │ Client 2 │ ... │              │
│         │   │  │ (stdio)  │ │ (HTTP)   │     │              │
│         │   │  └────┬─────┘ └────┬─────┘     │              │
│         │   └───────┼────────────┼────────────┘              │
│         │           │            │                            │
└─────────┼───────────┼────────────┼────────────────────────────┘
          │           │            │
          │    ┌──────▼──────┐ ┌──▼────────────┐
          │    │ MCP Server  │ │ MCP Server    │
          │    │ (本地进程)   │ │ (远程 HTTP)   │
          │    │ confluence  │ │ database-mcp  │
          │    └─────────────┘ └───────────────┘
```

### 2.2 内置 MCP 服务器

Claude Code 可以通过 `claude mcp serve` 命令将自身暴露为 MCP Server，让其他 MCP 客户端连接：

```bash
# 将 Claude Code 作为 MCP Server 启动
claude mcp serve
```

这使得其他 AI 应用（如 Claude Desktop）能够通过 MCP 协议调用 Claude Code 的文件操作、代码搜索等能力。

### 2.3 外部 MCP 客户端连接

Claude Code 支持两种 MCP 传输类型来连接外部 MCP Server：**stdio** 和 **Streamable HTTP**（替代旧的 HTTP+SSE 传输）。此外，也可以通过 SDK 在代码中程序化使用这些传输：

#### stdio 类型：启动子进程通信

最常用的方式。Claude Code 会启动 MCP Server 作为子进程，通过 stdin/stdout 进行 JSON-RPC 通信。

```bash
# 添加一个 stdio 类型的 MCP Server
claude mcp add confluence-mcp -- node /path/to/confluence-mcp/dist/index.js

# 也可以使用 npx
claude mcp add db-mcp -- npx @example/db-mcp-server
```

通信流程：

```
Claude Code                    MCP Server (子进程)
    │                               │
    │── spawn ──────────────────────→│  (启动子进程)
    │                               │
    │── stdin: JSON-RPC request ───→│  (发送请求)
    │                               │
    │←── stdout: JSON-RPC response ─│  (返回结果)
    │                               │
    │── stdin: JSON-RPC request ───→│  (继续通信)
    │←── stdout: JSON-RPC response ─│
    │                               │
    │── kill ───────────────────────→│  (结束时关闭)
```

**优势**：简单可靠，无需网络配置，进程生命周期可控
**适用**：本地工具、CLI 工具封装

#### Streamable HTTP 类型：基于 HTTP 的流式通信

适用于远程 MCP Server 或需要跨网络访问的场景。这是 MCP 协议中取代旧版 SSE 传输的新标准。

```bash
# 添加一个 Streamable HTTP 类型的 MCP Server
claude mcp add --transport http my-remote-mcp https://mcp.example.com/mcp
```

通信流程：

```
Claude Code                    MCP Server (HTTP)
    │                               │
    │── HTTP POST: JSON-RPC req ───→│  (发送请求)
    │←── HTTP Response (可选 SSE   ─│  (返回响应，支持流式)
    │     streaming 或普通 JSON)    │
    │                               │
```

与旧版 SSE 传输的区别：
- 旧版 SSE：需要先 GET 建立 SSE 长连接，再 POST 发请求，双通道通信
- Streamable HTTP：统一用 POST，响应可以是普通 JSON 或 SSE 流，单通道更简洁
- Streamable HTTP 支持无状态模式，更易于负载均衡和横向扩展

**优势**：支持远程部署、跨网络访问、更好的可扩展性
**适用**：远程服务、共享型 MCP Server

#### 程序化集成（通过 SDK）

SDK 不是一种独立的传输类型，而是在代码中直接使用 MCP Client SDK 创建连接的方式，底层仍使用 stdio 或 Streamable HTTP 传输：

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 创建传输层
const transport = new StdioClientTransport({
  command: "node",
  args: ["/path/to/mcp-server.js"],
});

// 创建客户端并连接
const client = new Client({ name: "my-app", version: "1.0.0" }, {});
await client.connect(transport);

// 列出可用工具
const tools = await client.listTools();

// 调用工具
const result = await client.callTool({
  name: "confluence_search",
  arguments: { query: "架构设计" },
});
```

### 2.4 MCP 工具/资源/命令集成

当 MCP Server 连接成功后，Claude Code 会：

1. **发现工具**：调用 `tools/list` 获取 Server 提供的所有工具定义
2. **注入 System Prompt**：将 MCP 工具的描述、参数 schema 注入到 LLM 的 system prompt 中
3. **代理调用**：当 LLM 决定调用某个 MCP 工具时，Claude Code 的 Tool System 会将调用路由到对应的 MCP Client
4. **返回结果**：MCP Server 的响应会作为 `tool_result` 反馈给 LLM

```
LLM 决策: "我需要搜索 Confluence"
    │
    ▼
Tool System 识别: mcp__confluence-mcp__confluence_search
    │
    ▼
MCP Manager 路由: 找到 confluence-mcp 对应的 Client
    │
    ▼
MCP Client 发送: JSON-RPC → Server
    │
    ▼
Server 执行: 调用 Confluence API
    │
    ▼
结果回传: Server → Client → Tool System → LLM
```

---

## 3. MCP 功能详解

### 3.1 工具扩展：通过 MCP 动态扩展工具集

MCP 最核心的能力是**工具（Tools）**。每个 MCP Server 可以暴露多个工具，每个工具有：

- **name**: 工具名称
- **description**: 工具描述（LLM 用来理解何时该使用此工具）
- **inputSchema**: JSON Schema 格式的参数定义

```typescript
// MCP Server 端定义一个工具
const SEARCH_TOOL = {
  name: 'confluence_search',
  description: '在 Confluence 中搜索页面内容。支持使用关键词搜索，可选指定空间缩小范围。',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      spaceKey: {
        type: 'string',
        description: '限定搜索的空间 Key（可选）',
      },
      limit: {
        type: 'number',
        description: '返回结果数量上限，默认 10',
      },
    },
    required: ['query'],
  },
};
```

工具定义中的 `description` 极为重要——它直接决定了 LLM 是否能正确判断何时使用这个工具。好的 description 应该：
- 清晰说明工具的功能
- 说明适用场景
- 描述输入/输出预期

### 3.2 资源（Resources）：读取和订阅外部数据源

除了工具，MCP 还支持**资源（Resources）**，它提供了一种让 LLM 读取和订阅外部数据的机制：

```typescript
// Server 端暴露资源
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "config://app/settings",
      name: "应用配置",
      description: "当前应用的配置信息",
      mimeType: "application/json",
    },
    {
      uri: "db://users/schema",
      name: "用户表结构",
      description: "用户数据库表的 Schema 定义",
      mimeType: "application/json",
    },
  ],
}));

// 处理资源读取请求
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "config://app/settings") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ theme: "dark", language: "zh-CN" }),
        },
      ],
    };
  }

  throw new Error(`未知资源: ${uri}`);
});
```

**Tools vs Resources 的区别**：

| 维度 | Tools | Resources |
|------|-------|-----------|
| 触发方式 | LLM 主动调用 | 客户端主动请求 / 订阅 |
| 副作用 | 可能有（写入、修改） | 只读 |
| 类比 | 函数调用 | 文件读取 |
| 示例 | 搜索、创建页面 | 读取配置、获取 Schema |

### 3.3 命令集成：MCP 服务器提供的自定义命令

MCP 还支持 **Prompts**（提示模板），Server 可以暴露预定义的提示模板供客户端使用：

```typescript
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "review-code",
      description: "生成代码审查提示",
      arguments: [
        { name: "code", description: "要审查的代码", required: true },
        { name: "language", description: "编程语言", required: false },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === "review-code") {
    return {
      description: "代码审查提示",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `请审查以下 ${request.params.arguments?.language || ""} 代码：\n\n${request.params.arguments?.code}`,
          },
        },
      ],
    };
  }
});
```

### 3.4 配置导入：从 Claude Desktop 导入 MCP 配置

Claude Code 可以自动读取 Claude Desktop 的 MCP 配置文件，避免重复配置：

```bash
# Claude Desktop 的配置文件路径
# macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
# Windows: %APPDATA%/Claude/claude_desktop_config.json

# 配置文件格式
{
  "mcpServers": {
    "confluence-mcp": {
      "command": "node",
      "args": ["/path/to/confluence-mcp/dist/index.js"],
      "env": {
        "CONFLUENCE_BASE_URL": "https://confluence.example.com",
        "CONFLUENCE_TOKEN": "your-token"
      }
    },
    "database-mcp": {
      "command": "npx",
      "args": ["@example/db-mcp-server"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/mydb"
      }
    }
  }
}
```

### 3.5 --mcp-config 动态加载

Claude Code 支持通过命令行参数动态加载 MCP 配置文件：

```bash
# 使用自定义配置文件启动
claude --mcp-config ./my-mcp-config.json

# 配置文件格式与 Claude Desktop 相同
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["./my-mcp-server.js"],
      "env": {
        "API_KEY": "xxx"
      }
    }
  }
}
```

这非常适合**团队协作**场景——将 MCP 配置文件纳入版本控制，团队成员可以共享同一套工具配置。

### 3.6 --strict-mcp-config 隔离模式

当使用 `--strict-mcp-config` 时，Claude Code 会进入严格的 MCP 隔离模式：

```bash
claude --mcp-config ./project-mcp.json --strict-mcp-config
```

在此模式下：
- **只加载**指定配置文件中的 MCP Server
- **不会**加载用户全局配置或 Claude Desktop 的 MCP 配置
- 确保了环境的**可复现性和安全性**

适用场景：
- CI/CD 环境中的自动化任务
- 安全敏感的生产环境
- 需要精确控制可用工具集的场景

---

## 4. MCP 工具命名规范

### 4.1 命名空间隔离

Claude Code 采用 `mcp__{serverName}__{toolName}` 的命名格式来确保工具名的唯一性：

```
mcp__confluence-mcp__confluence_search
│     │                │
│     │                └── 工具原始名称（Server 定义的）
│     │
│     └── MCP Server 名称（添加时指定的）
│
└── MCP 工具前缀（固定）
```

实际示例：

```
mcp__confluence-mcp__confluence_search       # 搜索 Confluence
mcp__confluence-mcp__confluence_get_content  # 获取页面内容
mcp__confluence-mcp__confluence_create_page  # 创建页面
mcp__database-mcp__query                     # 数据库查询
mcp__github-mcp__create_issue                # 创建 GitHub Issue
```

### 4.2 避免工具名冲突

命名空间隔离解决了多个 MCP Server 可能暴露同名工具的问题：

```
mcp__server-a__search    # Server A 的搜索工具
mcp__server-b__search    # Server B 的搜索工具
                         # 两者不会冲突
```

### 4.3 工具发现机制

当 Claude Code 启动并连接 MCP Server 后，工具发现流程如下：

```
1. 初始化阶段
   Claude Code ──── tools/list ────→ MCP Server
   Claude Code ←─── 工具列表 ────── MCP Server

2. 注册阶段
   对每个工具 t：
     内部名称 = "mcp__" + serverName + "__" + t.name
     注册到 Tool System（包含 description 和 inputSchema）

3. System Prompt 构建
   将所有 MCP 工具的定义注入 LLM system prompt：
   "你可以使用以下工具：
    - mcp__confluence-mcp__confluence_search: 搜索 Confluence...
    - mcp__confluence-mcp__confluence_get_content: 获取页面..."

4. 运行时调用
   LLM 输出 tool_use → Tool System 解析命名空间 → 路由到对应 MCP Client → 调用 Server
```

---

## 5. MCP 通信协议细节

### 5.1 JSON-RPC 2.0 基础

MCP 建立在 **JSON-RPC 2.0** 协议之上。所有通信都是结构化的 JSON 消息。

JSON-RPC 2.0 的三种消息类型：

```typescript
// 1. 请求（Request）—— 有 id，期待响应
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "confluence_search",
    "arguments": {
      "query": "架构设计",
      "limit": 5
    }
  }
}

// 2. 响应（Response）—— 对应请求的 id
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "搜索结果..."
      }
    ],
    "isError": false
  }
}

// 3. 通知（Notification）—— 无 id，不期待响应
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

### 5.2 工具调用的请求/响应格式

#### 列出工具（tools/list）

```typescript
// 请求
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}

// 响应
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "confluence_search",
        "description": "在 Confluence 中搜索页面内容...",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "搜索关键词" },
            "spaceKey": { "type": "string", "description": "空间 Key" },
            "limit": { "type": "number", "description": "结果数量" }
          },
          "required": ["query"]
        }
      },
      {
        "name": "confluence_get_content",
        "description": "获取 Confluence 页面内容...",
        "inputSchema": { ... }
      }
    ]
  }
}
```

#### 调用工具（tools/call）

```typescript
// 请求
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "confluence_search",
    "arguments": {
      "query": "微服务架构",
      "spaceKey": "DEV",
      "limit": 10
    }
  }
}

// 成功响应
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "搜索 \"微服务架构\" 找到 3 条结果:\n\n1. **微服务架构设计文档** (ID: 12345)..."
      }
    ],
    "isError": false
  }
}

// 工具执行失败（注意：这不是 JSON-RPC 错误，而是工具级别的错误）
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "错误: 无法连接到 Confluence 服务器"
      }
    ],
    "isError": true
  }
}
```

#### 初始化握手（initialize）

MCP 连接建立时的第一步是能力协商：

```typescript
// Client → Server: 初始化请求
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "roots": { "listChanged": true }
    },
    "clientInfo": {
      "name": "claude-code",
      "version": "2.1.80"
    }
  }
}

// Server → Client: 初始化响应
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {}
    },
    "serverInfo": {
      "name": "confluence-mcp-server",
      "version": "1.0.0"
    }
  }
}

// Client → Server: 初始化完成通知
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

### 5.3 错误处理

MCP 定义了两层错误处理：

**第一层：JSON-RPC 协议级错误**（传输/协议问题）

```typescript
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32601,       // 标准 JSON-RPC 错误码
    "message": "Method not found: tools/unknown_method"
  }
}
```

常见错误码：

| 错误码 | 含义 |
|--------|------|
| -32700 | Parse error（JSON 解析失败） |
| -32600 | Invalid Request（请求格式不正确） |
| -32601 | Method not found（方法不存在） |
| -32602 | Invalid params（参数不正确） |
| -32603 | Internal error（服务器内部错误） |

**第二层：工具执行级错误**（业务逻辑问题）

```typescript
// 工具级错误通过 isError 标记，仍然是正常的 JSON-RPC 响应
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      { "type": "text", "text": "未知工具: invalid_tool_name" }
    ],
    "isError": true   // 标记这是工具执行错误
  }
}
```

两层错误的关键区别：
- **协议级错误**：说明通信本身出了问题，客户端需要重试或报错
- **工具级错误**：工具执行失败但通信正常，LLM 可以根据错误信息调整策略重试

---

## 6. 实际应用场景

### 6.1 数据库查询 MCP

让 LLM 能够直接查询数据库，而不需要用户手写 SQL：

```typescript
// 工具定义
const QUERY_TOOL = {
  name: "query",
  description: "执行只读 SQL 查询，返回结果集",
  inputSchema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "SQL 查询语句（只允许 SELECT）" },
      database: { type: "string", description: "目标数据库名称" },
    },
    required: ["sql"],
  },
};

// 工具实现（带安全检查）
async function handleQuery(params: { sql: string; database?: string }) {
  const { sql } = params;

  // 安全检查：只允许 SELECT
  if (!/^\s*SELECT\b/i.test(sql)) {
    return {
      content: [{ type: "text", text: "安全限制：只允许 SELECT 查询" }],
      isError: true,
    };
  }

  const result = await db.query(sql);
  return {
    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
    isError: false,
  };
}
```

使用场景：
- "帮我查一下最近 7 天的订单量趋势"
- "用户表里有多少活跃用户？"
- "这个 SQL 执行结果是什么？"

### 6.2 API 集成 MCP

将公司内部 API 封装为 MCP Server，让 LLM 能够调用：

```typescript
// 将多个 API 端点暴露为 MCP 工具
const tools = [
  {
    name: "get_user_info",
    description: "通过用户ID获取用户详细信息",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "用户 ID" },
      },
      required: ["userId"],
    },
  },
  {
    name: "list_services",
    description: "列出所有微服务及其健康状态",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_metrics",
    description: "获取指定服务的性能指标",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "服务名称" },
        timeRange: { type: "string", description: "时间范围，如 1h, 24h, 7d" },
      },
      required: ["service"],
    },
  },
];
```

### 6.3 文档系统 MCP（如 Confluence MCP）

本仓库中的 `AI/mcp/confluence-mcp/` 就是一个典型的文档系统 MCP 实现。它暴露了以下工具：

| 工具名 | 功能 |
|--------|------|
| `confluence_search` | 使用 CQL 搜索 Confluence 页面 |
| `confluence_get_content` | 获取页面内容（支持 URL 和 ID） |
| `confluence_list_spaces` | 列出所有可访问的空间 |
| `confluence_get_children` | 获取页面的子页面列表 |
| `confluence_create_page` | 在指定空间创建新页面 |
| `confluence_update_page` | 更新已有页面内容 |

使用场景：
- "搜索一下我们的 API 规范文档"
- "把这个页面的内容读出来"
- "帮我在 DEV 空间创建一个新的设计文档"
- "把会议纪要更新到 Confluence 上"

### 6.4 自定义工具开发

MCP 的开放性意味着你可以将**任何能力**封装为 MCP Server：

- **Jira MCP** —— 创建/查询/更新 Jira Issue
- **Slack MCP** —— 发送消息、搜索聊天记录
- **Git MCP** —— 查看 commit 历史、diff、blame
- **监控 MCP** —— 查询 Prometheus 指标、Grafana 面板
- **部署 MCP** —— 触发 CI/CD 流水线、查看部署状态
- **文件系统 MCP** —— 跨机器读写文件

---

## 7. 如何开发一个 MCP Server（简要指南）

### 7.1 项目初始化

```bash
mkdir my-mcp-server
cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk
npm install -D typescript @types/node
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

`package.json` 中添加：

```json
{
  "type": "module",
  "bin": {
    "my-mcp-server": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "start": "node dist/index.js"
  }
}
```

### 7.2 实现 Server

```typescript
// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ============================================
// 第一步：定义工具
// ============================================
const TOOLS = [
  {
    name: "hello",
    description: "一个简单的打招呼工具，用于测试 MCP 连接是否正常",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "要打招呼的人名",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "calculate",
    description: "执行简单的数学计算",
    inputSchema: {
      type: "object" as const,
      properties: {
        expression: {
          type: "string",
          description: "数学表达式，如 '2 + 3 * 4'",
        },
      },
      required: ["expression"],
    },
  },
];

// ============================================
// 第二步：实现工具处理逻辑
// ============================================
function handleHello(params: { name: string }) {
  return {
    content: [
      { type: "text" as const, text: `你好, ${params.name}! MCP 连接正常。` },
    ],
    isError: false,
  };
}

function handleCalculate(params: { expression: string }) {
  try {
    // 注意：生产环境不要用 eval，这里仅作演示
    // 应该使用安全的表达式解析库如 mathjs
    const result = Function(`"use strict"; return (${params.expression})`)();
    return {
      content: [
        { type: "text" as const, text: `${params.expression} = ${result}` },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `计算错误: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// ============================================
// 第三步：创建 Server 并注册处理器
// ============================================
const server = new Server(
  {
    name: "my-mcp-server",       // Server 标识名
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},                 // 声明支持工具能力
      // resources: {},          // 如需支持资源，取消注释
      // prompts: {},            // 如需支持提示模板，取消注释
    },
  }
);

// 处理工具列表请求
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// 处理工具调用请求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "hello":
      return handleHello(args as { name: string });
    case "calculate":
      return handleCalculate(args as { expression: string });
    default:
      return {
        content: [{ type: "text", text: `未知工具: ${name}` }],
        isError: true,
      };
  }
});

// ============================================
// 第四步：启动 Server（使用 stdio 传输）
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server 已启动 (stdio 模式)");  // 注意用 stderr，stdout 留给 JSON-RPC
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
```

### 7.3 注册到 Claude Code

```bash
# 编译
cd my-mcp-server && npm run build

# 方法一：通过 CLI 添加
claude mcp add my-mcp -- node /absolute/path/to/my-mcp-server/dist/index.js

# 方法二：通过配置文件
# 在 .claude/mcp.json 或全局配置中添加：
{
  "mcpServers": {
    "my-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/my-mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

### 7.4 验证工具是否可用

启动 Claude Code 后，可以通过以下方式验证：

```bash
# 查看已注册的 MCP Server
claude mcp list

# 在对话中直接使用
# Claude Code 会自动发现 mcp__my-mcp__hello 和 mcp__my-mcp__calculate 工具
```

### 7.5 开发最佳实践

**工具设计原则**：

```
1. 单一职责 —— 每个工具做一件事，做好一件事
   Bad:  "search_and_update"
   Good: "search" + "update"（分成两个工具）

2. 清晰的描述 —— LLM 靠描述决定何时使用工具
   Bad:  "处理数据"
   Good: "在 PostgreSQL 数据库中执行只读 SQL 查询，返回 JSON 格式结果集"

3. 严格的 Schema —— 用 JSON Schema 约束参数
   - 使用 required 标记必填参数
   - 为每个参数提供 description
   - 使用 enum 限制取值范围

4. 优雅的错误处理 —— isError: true + 有意义的错误信息
   Bad:  { isError: true, content: [{ text: "error" }] }
   Good: { isError: true, content: [{ text: "查询失败: 表 'users' 不存在，可用表: orders, products" }] }

5. 安全第一 —— 不要信任 LLM 传入的参数
   - 验证所有输入
   - 使用最小权限原则
   - 对危险操作（删除、修改）要求确认
```

**日志与调试**：

```typescript
// 重要：stdout 被 JSON-RPC 占用，日志必须输出到 stderr
console.error("[DEBUG] 收到请求:", request.params.name);
console.error("[INFO] 查询结果:", results.length, "条");

// 或使用专门的日志库，配置输出到 stderr / 文件
```

**环境变量管理**：

```typescript
// 通过环境变量传入配置，避免硬编码
const config = {
  apiUrl: process.env.API_BASE_URL || "http://localhost:8080",
  apiKey: process.env.API_KEY,
  timeout: parseInt(process.env.TIMEOUT || "30000"),
};

if (!config.apiKey) {
  console.error("错误: 请设置 API_KEY 环境变量");
  process.exit(1);
}
```

---

## 总结

MCP 协议的核心价值在于**标准化**。通过统一的协议规范，实现了：

```
                        ┌─ 数据库查询
                        ├─ 文档系统（Confluence）
AI 应用 ── MCP 协议 ──├─ 项目管理（Jira）
                        ├─ 代码仓库（GitHub）
                        ├─ 监控系统（Prometheus）
                        └─ 任何自定义服务
```

关键要点：
1. **MCP 是 AI 世界的 USB** —— 一次实现，到处连接
2. **三大能力**：Tools（执行操作）、Resources（读取数据）、Prompts（模板复用）
3. **基于 JSON-RPC 2.0** —— 成熟的协议基础，传输层可插拔
4. **命名空间隔离** —— `mcp__{server}__{tool}` 避免冲突
5. **安全可控** —— 权限系统、隔离模式、参数校验
6. **开发门槛低** —— 借助 SDK 几十行代码即可实现一个 MCP Server
