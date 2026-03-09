import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config } from '../types.js';
import { processConfluencePage } from '../utils/convert.js';
import { extractPageId, extractSpaceAndTitle } from '../utils/url.js';
import { createApiClient, formatAxiosError } from '../utils/api.js';

interface GetContentParams {
  page?: string;
  pageId?: string;
}

export const GET_CONTENT_TOOL = {
  name: 'confluence_get_content',
  description: `获取 Confluence 页面内容，支持通过页面链接或页面ID获取。
    返回内容包括：Markdown 格式正文、HTML 原文、页面元数据（标题、作者、更新时间等）。
    支持的 URL 格式：
    - https://confluence.example.com/pages/viewpage.action?pageId=12345
    - https://confluence.example.com/wiki/spaces/SPACE/pages/12345/Title
    - https://confluence.example.com/display/SPACE/Title`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      page: {
        type: 'string',
        description: 'Confluence 页面链接',
      },
      pageId: {
        type: 'string',
        description: 'Confluence 页面 ID（数字 ID）',
      },
    },
  },
};

export async function handleGetContent(
  params: GetContentParams,
  config: Config,
): Promise<CallToolResult> {
  const { page, pageId } = params;
  const api = createApiClient(config);

  try {
    let id = pageId || (page ? extractPageId(page) : null);

    // 如果 URL 是 /display/SPACE/Title 格式，通过 title + space 查询
    if (!id && page) {
      const info = extractSpaceAndTitle(page);
      if (info) {
        const res = await api.get('/content', {
          params: {
            spaceKey: info.spaceKey,
            title: info.title,
            expand: 'body.storage,body.view,version,space',
          },
        });
        const results = res.data?.results;
        if (results && results.length > 0) {
          id = results[0].id;
        }
      }
    }

    if (!id) {
      return {
        content: [{ type: 'text', text: '无法从提供的参数中解析出页面 ID，请提供有效的 Confluence 页面链接或数字 ID' }],
        isError: true,
      };
    }

    const response = await api.get(`/content/${id}`, {
      params: { expand: 'body.storage,body.view,version,space' },
    });

    const result = processConfluencePage(response.data);

    return {
      content: [
        { type: 'text', text: `📄 页面元数据:\n${JSON.stringify(result.metadata, null, 2)}` },
        { type: 'text', text: `📝 Markdown 内容:\n${result.markdown}` },
        { type: 'text', text: `🌐 HTML 内容:\n${result.html}` },
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
