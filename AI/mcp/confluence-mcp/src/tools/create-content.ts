import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config } from '../types.js';
import { createApiClient, formatAxiosError } from '../utils/api.js';

interface CreateContentParams {
  title: string;
  spaceKey: string;
  body: string;
  parentId?: string;
}

interface UpdateContentParams {
  pageId: string;
  title: string;
  body: string;
  version: number;
}

export const CREATE_PAGE_TOOL = {
  name: 'confluence_create_page',
  description: `在指定的 Confluence 空间中创建新页面。
    需要提供空间 Key、页面标题和正文内容（Confluence Storage 格式或纯文本均可）。
    可选指定父页面 ID 以创建子页面。`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: '页面标题',
      },
      spaceKey: {
        type: 'string',
        description: '目标空间 Key（例如 "DEV"）',
      },
      body: {
        type: 'string',
        description: '页面正文内容（支持 HTML 或纯文本，纯文本会自动包裹为 HTML）',
      },
      parentId: {
        type: 'string',
        description: '父页面 ID（可选，用于创建子页面）',
      },
    },
    required: ['title', 'spaceKey', 'body'],
  },
};

export const UPDATE_PAGE_TOOL = {
  name: 'confluence_update_page',
  description: `更新已有的 Confluence 页面内容。
    需要提供页面 ID、新标题、新正文和当前版本号。
    版本号可通过 confluence_get_content 获取页面元数据得到。`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      pageId: {
        type: 'string',
        description: '要更新的页面 ID',
      },
      title: {
        type: 'string',
        description: '页面新标题',
      },
      body: {
        type: 'string',
        description: '页面新正文内容（支持 HTML 或纯文本）',
      },
      version: {
        type: 'number',
        description: '当前页面版本号（将自动 +1），可通过 get_content 获取',
      },
    },
    required: ['pageId', 'title', 'body', 'version'],
  },
};

function wrapBodyAsStorage(body: string): string {
  if (body.trim().startsWith('<')) return body;
  return body
    .split('\n')
    .map(line => `<p>${line}</p>`)
    .join('');
}

export async function handleCreatePage(
  params: CreateContentParams,
  config: Config,
): Promise<CallToolResult> {
  const { title, spaceKey, body, parentId } = params;
  const api = createApiClient(config);

  try {
    const payload: any = {
      type: 'page',
      title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: wrapBodyAsStorage(body),
          representation: 'storage',
        },
      },
    };

    if (parentId) {
      payload.ancestors = [{ id: parentId }];
    }

    const response = await api.post('/content', payload);

    const pageUrl = `${response.data._links?.base || config.baseUrl}${response.data._links?.webui || ''}`;

    return {
      content: [
        {
          type: 'text',
          text: `✅ 页面创建成功！\n\n标题: ${response.data.title}\nID: ${response.data.id}\n空间: ${spaceKey}\n链接: ${pageUrl}`,
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

export async function handleUpdatePage(
  params: UpdateContentParams,
  config: Config,
): Promise<CallToolResult> {
  const { pageId, title, body, version } = params;
  const api = createApiClient(config);

  try {
    const payload = {
      type: 'page',
      title,
      body: {
        storage: {
          value: wrapBodyAsStorage(body),
          representation: 'storage',
        },
      },
      version: { number: version + 1 },
    };

    const response = await api.put(`/content/${pageId}`, payload);

    const pageUrl = `${response.data._links?.base || config.baseUrl}${response.data._links?.webui || ''}`;

    return {
      content: [
        {
          type: 'text',
          text: `✅ 页面更新成功！\n\n标题: ${response.data.title}\nID: ${response.data.id}\n新版本: ${response.data.version?.number}\n链接: ${pageUrl}`,
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
