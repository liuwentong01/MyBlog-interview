import TurndownService from 'turndown';

function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  turndown.addRule('betterTable', {
    filter: 'table',
    replacement(_content, node) {
      const table = node as HTMLTableElement;
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) return _content;

      let md = '\n';
      const headerRow = rows[0];
      const headers = Array.from(headerRow.querySelectorAll('th, td'));

      if (headers.length > 0) {
        md += '| ' + headers.map(th => th.textContent?.trim() || '').join(' | ') + ' |\n';
        md += '|' + headers.map(() => '---').join('|') + '|\n';
      }

      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td, th'));
        if (cells.length > 0) {
          md += '| ' + cells.map(td => td.textContent?.trim() || '').join(' | ') + ' |\n';
        }
      }
      return md + '\n';
    },
  });

  turndown.addRule('betterImages', {
    filter: 'img',
    replacement(_content, node) {
      const img = node as HTMLImageElement;
      const src = img.getAttribute('src') || '';
      let filename = '图片';
      if (src) {
        const matches = src.match(/\/([^/]+\.(png|jpg|jpeg|gif|svg))/i);
        if (matches) filename = matches[1];
      }
      return `![${filename}]`;
    },
  });

  turndown.addRule('codeBlock', {
    filter(node) {
      return (
        node.nodeName === 'PRE' ||
        (node.nodeName === 'DIV' &&
          (node.getAttribute('class')?.includes('code') ?? false))
      );
    },
    replacement(content) {
      return '\n```\n' + content.trim() + '\n```\n';
    },
  });

  return turndown;
}

/**
 * 将 Confluence API 返回的页面数据转换为结构化结果
 */
export function processConfluencePage(response: any) {
  const turndown = createTurndown();

  const rawHtml =
    response.body?.view?.value || response.body?.storage?.value || '';

  const decodedHtml = rawHtml.replace(
    /\\u([0-9a-fA-F]{4})/g,
    (_match: string, code: string) => String.fromCharCode(parseInt(code, 16)),
  );

  const preprocessedHtml = decodedHtml
    .replace(/<div class="table-wrap">/g, '')
    .replace(/<\/div>/g, '')
    .replace(/<img([^>]*?)alt=""([^>]*?)>/g, '<img$1alt="图片"$2>')
    .replace(/<div class="content-wrapper">/g, '')
    .replace(/<br\s*\/?>/g, '\n');

  const markdown = turndown.turndown(preprocessedHtml);

  const cleanMarkdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*(\d+\.)\s*/gm, '$1 ')
    .replace(/^\s*(-)\s*/gm, '$1 ')
    .replace(/\n\n(\|.*\|)\n\n/g, '\n\n$1\n')
    .trim();

  return {
    markdown: cleanMarkdown,
    text: extractText(preprocessedHtml),
    html: decodedHtml,
    metadata: {
      id: response.id,
      title: response.title,
      author: response.version?.by?.displayName || '',
      updated: response.version?.when || '',
      url: `${response._links?.base || ''}${response._links?.webui || ''}`,
      spaceKey: response.space?.key || '',
    },
  };
}

function extractText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
