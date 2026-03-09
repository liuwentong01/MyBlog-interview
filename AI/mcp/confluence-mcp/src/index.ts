#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { Config } from './types.js';

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let baseUrl = '';
  let token = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--base-url':
        baseUrl = args[++i] || '';
        break;
      case '--token':
        token = args[++i] || '';
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (!baseUrl || !token) {
    console.error(MISSING_CONFIG_MESSAGE);
    process.exit(1);
  }

  // 移除尾部斜杠
  baseUrl = baseUrl.replace(/\/+$/, '');

  return { baseUrl, token };
}

function printHelp() {
  console.error(`
Confluence MCP Server

用法:
  confluence-mcp --base-url <URL> --token <TOKEN>

参数:
  --base-url  Confluence 实例地址，例如 https://confluence.example.com
  --token     Confluence Personal Access Token
  --help      显示帮助信息

示例:
  confluence-mcp --base-url https://confluence.example.com --token YOUR_TOKEN
`);
}

async function main() {
  const config = parseArgs();
  const transport = new StdioServerTransport();
  const server = createServer(config);
  await server.connect(transport);
  console.error('Confluence MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

const MISSING_CONFIG_MESSAGE = `❌ 缺少必需的配置参数

请提供 --base-url 和 --token 参数：

  confluence-mcp --base-url https://confluence.example.com --token YOUR_TOKEN

如何获取 Confluence Personal Access Token：
  1. 登录到你的 Confluence 实例
  2. 点击右上角头像 → Personal Settings（个人设置）
  3. 在左侧菜单选择 "Personal Access Tokens"
  4. 点击 "Create token" 创建新的 API Token
  5. 复制生成的 Token

在 Cursor 中配置 MCP：
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": [
        "/path/to/confluence-mcp/dist/index.js",
        "--base-url", "https://confluence.example.com",
        "--token", "YOUR_TOKEN"
      ]
    }
  }
}`;
