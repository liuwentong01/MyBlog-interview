import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config, ConfluenceChildPage } from '../types.js';
import { createApiClient, formatAxiosError } from '../utils/api.js';

interface GetChildrenParams {
  pageId: string;
  limit?: number;
}

export const GET_CHILDREN_TOOL = {
  name: 'confluence_get_children',
  description: `获取指定 Confluence 页面的子页面列表。
    需要提供父页面的 ID。
    可用于浏览页面树结构、了解文档层级。`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      pageId: {
        type: 'string',
        description: '父页面的 ID（数字 ID）',
      },
      limit: {
        type: 'number',
        description: '返回子页面数量上限，默认 25',
      },
    },
    required: ['pageId'],
  },
};

export async function handleGetChildren(
  params: GetChildrenParams,
  config: Config,
): Promise<CallToolResult> {
  const { pageId, limit = 25 } = params;
  const api = createApiClient(config);

  try {
    const response = await api.get(`/content/${pageId}/child/page`, {
      params: {
        limit: Math.min(limit, 100),
        expand: 'version',
      },
    });

    const children: ConfluenceChildPage[] = (response.data?.results || []).map(
      (c: any) => ({
        id: c.id,
        title: c.title,
        url: `${response.data._links?.base || config.baseUrl}${c._links?.webui || ''}`,
        status: c.status,
      }),
    );

    if (children.length === 0) {
      return {
        content: [{ type: 'text', text: `页面 ${pageId} 没有子页面` }],
        isError: false,
      };
    }

    const formatted = children
      .map((c, i) => `${i + 1}. **${c.title}** (ID: ${c.id})\n   链接: ${c.url}`)
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `📂 页面 ${pageId} 的子页面（共 ${children.length} 个）:\n\n${formatted}`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: formatAxiosError(error) }],
      isError: true,
    };
  }
}
