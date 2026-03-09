/**
 * 从 Confluence URL 中提取 pageId
 * 支持多种 URL 格式：
 *   - /pages/viewpage.action?pageId=12345
 *   - /wiki/spaces/SPACE/pages/12345/Title
 *   - /display/SPACE/Title (需要通过 API 二次查询，此处返回 null)
 */
export function extractPageId(url: string): string | null {
  // 格式1: ?pageId=12345
  const queryMatch = url.match(/pageId=(\d+)/);
  if (queryMatch) return queryMatch[1];

  // 格式2: /pages/12345 或 /wiki/spaces/SPACE/pages/12345
  const pathMatch = url.match(/\/pages\/(\d+)/);
  if (pathMatch) return pathMatch[1];

  return null;
}

/**
 * 从 Confluence URL 中提取 spaceKey 和 title
 * 用于 /display/SPACE/Title 格式的 URL
 */
export function extractSpaceAndTitle(url: string): { spaceKey: string; title: string } | null {
  const match = url.match(/\/display\/([^/]+)\/(.+?)(?:\?|#|$)/);
  if (match) {
    return {
      spaceKey: match[1],
      title: decodeURIComponent(match[2].replace(/\+/g, ' ')),
    };
  }
  return null;
}

/**
 * 从 Confluence URL 中提取 base URL
 */
export function extractBaseUrl(url: string): string | null {
  const match = url.match(/(https?:\/\/[^/]+)/);
  return match ? match[1] : null;
}
