import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config, ConfluenceSearchItem } from '../types.js';
import { createApiClient, formatAxiosError } from '../utils/api.js';

interface SearchParams {
  query: string;
  spaceKey?: string;
  limit?: number;
}

export const SEARCH_TOOL = {
  name: 'confluence_search',
  description: `在 Confluence 中搜索页面内容。
    支持使用关键词搜索，可选指定空间(spaceKey)缩小范围。
    返回匹配页面的标题、摘要、空间信息和链接。
    内部使用 CQL (Confluence Query Language) 进行搜索。`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      spaceKey: {
        type: 'string',
        description: '限定搜索的空间 Key（可选，例如 "DEV"、"PRODUCT"）',
      },
      limit: {
        type: 'number',
        description: '返回结果数量上限，默认 10，最大 50',
      },
    },
    required: ['query'],
  },
};

export async function handleSearch(
  params: SearchParams,
  config: Config,
): Promise<CallToolResult> {
  const { query, spaceKey, limit = 10 } = params;
  const api = createApiClient(config);

  try {
    let cql = `type=page AND text ~ "${query}"`;
    if (spaceKey) {
      cql += ` AND space="${spaceKey}"`;
    }

    const response = await api.get('/content/search', {
      params: {
        cql,
        limit: Math.min(limit, 50),
        expand: 'space,version',
      },
    });

    const results: ConfluenceSearchItem[] = (response.data?.results || []).map(
      (item: any) => ({
        id: item.id,
        title: item.title,
        url: `${response.data._links?.base || config.baseUrl}${item._links?.webui || ''}`,
        excerpt: item.excerpt?.replace(/<[^>]*>/g, '').trim() || '',
        spaceKey: item.space?.key || '',
        spaceName: item.space?.name || '',
        lastModified: item.version?.when || '',
        type: item.type,
      }),
    );

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `未找到匹配 "${query}" 的页面` }],
        isError: false,
      };
    }

    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}** (ID: ${r.id})\n   空间: ${r.spaceName} [${r.spaceKey}]\n   更新: ${r.lastModified}\n   摘要: ${r.excerpt}\n   链接: ${r.url}`,
      )
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `🔍 搜索 "${query}" 找到 ${response.data.size || results.length} 条结果:\n\n${formatted}`,
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
