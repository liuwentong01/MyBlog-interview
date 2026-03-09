#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { Config } from './types.js';

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let baseUrl = '';
  let token = '';
  let cookie = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--base-url':
        baseUrl = args[++i] || '';
        break;
      case '--token':
        token = args[++i] || '';
        break;
      case '--cookie':
        cookie = args[++i] || '';
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (!baseUrl) {
    console.error(MISSING_CONFIG_MESSAGE);
    process.exit(1);
  }

  if (!token && !cookie) {
    console.error('❌ 必须提供 --token 或 --cookie 中的至少一个认证参数\n');
    console.error(MISSING_CONFIG_MESSAGE);
    process.exit(1);
  }

  baseUrl = baseUrl.replace(/\/+$/, '');

  return { baseUrl, token: token || undefined, cookie: cookie || undefined };
}

function printHelp() {
  console.error(`
Confluence MCP Server

用法:
  confluence-mcp --base-url <URL> --token <TOKEN>
  confluence-mcp --base-url <URL> --cookie <COOKIE>

参数:
  --base-url  Confluence 实例地址，例如 https://confluence.example.com
  --token     Confluence Personal Access Token（直连时使用）
  --cookie    浏览器 Cookie 字符串（SSO 环境下使用）
  --help      显示帮助信息

认证方式:
  方式1 (Token): 适用于 Confluence 可直连、无 SSO 拦截的环境
    confluence-mcp --base-url https://confluence.example.com --token YOUR_TOKEN

  方式2 (Cookie): 适用于有 SSO 网关拦截的环境
    1. 在浏览器中登录 Confluence
    2. 打开 DevTools (F12) → Network 标签
    3. 刷新页面，点击任意请求，复制 Request Headers 中的 Cookie 值
    4. 传入 --cookie 参数
`);
}

async function main() {
  const config = parseArgs();
  const transport = new StdioServerTransport();
  const server = createServer(config);
  await server.connect(transport);
  console.error(`Confluence MCP Server running on stdio (auth: ${config.cookie ? 'cookie' : 'token'})`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

const MISSING_CONFIG_MESSAGE = `请提供 --base-url 和认证参数：

  # Token 方式（直连）
  confluence-mcp --base-url https://confluence.example.com --token YOUR_TOKEN

  # Cookie 方式（SSO 环境）
  confluence-mcp --base-url https://confluence.example.com --cookie "YOUR_COOKIE_STRING"

获取 Cookie 的方法：
  1. 在浏览器中登录 Confluence
  2. 按 F12 打开 DevTools → Network 标签
  3. 刷新页面，点击任意一个请求
  4. 在 Request Headers 中找到 Cookie 字段，复制完整值

在 Cursor 中配置：
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": [
        "/path/to/confluence-mcp/dist/index.js",
        "--base-url", "https://confluence.example.com",
        "--cookie", "YOUR_COOKIE_STRING"
      ]
    }
  }
}`;
