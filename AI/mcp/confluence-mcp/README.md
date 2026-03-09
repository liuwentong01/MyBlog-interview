# Confluence MCP Server

基于 [Model Context Protocol](https://modelcontextprotocol.io/) 的 Confluence 集成服务，让 AI 助手能够直接读写公司 Confluence 平台。

## 功能

| 工具 | 说明 |
|------|------|
| `confluence_get_content` | 获取页面内容（支持 URL 或 pageId），返回 Markdown / HTML / 元数据 |
| `confluence_search` | 使用关键词搜索页面，支持限定空间范围 |
| `confluence_list_spaces` | 列出可访问的空间列表 |
| `confluence_get_children` | 获取指定页面的子页面列表 |
| `confluence_create_page` | 在指定空间中创建新页面 |
| `confluence_update_page` | 更新已有页面内容 |

## 快速开始

### 1. 安装依赖并编译

```bash
cd AI/mcp/confluence-mcp
npm install
npm run build
```

### 2. 获取 Confluence Token

1. 登录你的 Confluence 实例
2. 点击右上角头像 → **Personal Settings**
3. 左侧菜单选择 **Personal Access Tokens**
4. 点击 **Create token** 创建新 Token
5. 复制生成的 Token

### 3. 在 Cursor 中配置 MCP

编辑 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": [
        "/absolute/path/to/AI/mcp/confluence-mcp/dist/index.js",
        "--base-url", "https://confluence.your-company.com",
        "--token", "YOUR_PERSONAL_ACCESS_TOKEN"
      ]
    }
  }
}
```

### 4. 直接运行（调试用）

```bash
node dist/index.js --base-url https://confluence.example.com --token YOUR_TOKEN
```

## 架构

```
src/
├── index.ts              # 入口：解析 CLI 参数，启动 stdio 传输
├── server.ts             # MCP Server 工厂：注册工具列表和调度逻辑
├── types.ts              # 类型定义
├── tools/
│   ├── index.ts          # 聚合导出所有工具描述和处理函数
│   ├── get-content.ts    # 获取页面内容
│   ├── search.ts         # 搜索页面
│   ├── list-spaces.ts    # 列出空间
│   ├── get-children.ts   # 获取子页面
│   └── create-content.ts # 创建/更新页面
└── utils/
    ├── api.ts            # Axios API 客户端封装
    ├── convert.ts        # HTML → Markdown 转换（Turndown）
    └── url.ts            # Confluence URL 解析工具
```

## 技术栈

- **MCP SDK**: `@modelcontextprotocol/sdk` — MCP 协议 TypeScript 实现
- **传输层**: stdio（标准输入输出），兼容 Cursor、Claude Desktop 等客户端
- **HTTP**: axios — 调用 Confluence REST API
- **HTML→MD**: turndown — 将 Confluence 页面内容转为 Markdown
