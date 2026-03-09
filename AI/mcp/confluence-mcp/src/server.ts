import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Config } from './types.js';
import { ALL_TOOLS, HANDLER_MAP } from './tools/index.js';

/**
 * 创建 Confluence MCP Server 实例
 * 注册所有工具的 list 和 call 处理逻辑
 */
export function createServer(config: Config): Server {
  const server = new Server(
    {
      name: 'confluence-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const name = request.params.name;
      const params = request.params.arguments;
      const handler = HANDLER_MAP[name];

      if (!name || !handler) {
        return {
          content: [{ type: 'text', text: `未知工具: ${name}` }],
          isError: true,
        };
      }

      return await handler(params, config);
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `错误: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
