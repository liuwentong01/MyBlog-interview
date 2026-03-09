import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config, ConfluenceSpace } from '../types.js';
import { createApiClient, formatAxiosError } from '../utils/api.js';

interface ListSpacesParams {
  type?: string;
  limit?: number;
}

export const LIST_SPACES_TOOL = {
  name: 'confluence_list_spaces',
  description: `列出 Confluence 中可访问的空间列表。
    可选按类型筛选（global 全局空间 / personal 个人空间）。
    返回空间的 Key、名称、类型和描述。`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        description: '空间类型筛选：global（全局空间）或 personal（个人空间），不填返回全部',
        enum: ['global', 'personal'],
      },
      limit: {
        type: 'number',
        description: '返回数量上限，默认 25',
      },
    },
  },
};

export async function handleListSpaces(
  params: ListSpacesParams,
  config: Config,
): Promise<CallToolResult> {
  const { type, limit = 25 } = params;
  const api = createApiClient(config);

  try {
    const queryParams: Record<string, any> = {
      limit: Math.min(limit, 100),
      expand: 'description.plain',
    };
    if (type) queryParams.type = type;

    const response = await api.get('/space', { params: queryParams });

    const spaces: ConfluenceSpace[] = (response.data?.results || []).map(
      (s: any) => ({
        key: s.key,
        name: s.name,
        type: s.type,
        description: s.description?.plain?.value?.trim() || '',
        url: `${config.baseUrl}/display/${s.key}`,
      }),
    );

    if (spaces.length === 0) {
      return {
        content: [{ type: 'text', text: '未找到可访问的空间' }],
        isError: false,
      };
    }

    const formatted = spaces
      .map(
        (s, i) =>
          `${i + 1}. **${s.name}** [${s.key}]\n   类型: ${s.type === 'global' ? '全局空间' : '个人空间'}\n   描述: ${s.description || '（无描述）'}\n   链接: ${s.url}`,
      )
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `📚 共 ${spaces.length} 个空间:\n\n${formatted}`,
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
