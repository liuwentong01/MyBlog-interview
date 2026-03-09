import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** MCP 服务器全局配置 */
export interface Config {
  /** Confluence 实例的 base URL，例如 https://confluence.example.com */
  baseUrl: string;
  /** Confluence Personal Access Token（直连时使用） */
  token?: string;
  /** 浏览器 Cookie 字符串（SSO 环境下使用，从浏览器复制） */
  cookie?: string;
}

/** 工具处理函数签名 */
export type ToolHandler<T = any> = (
  params: T,
  config: Config,
) => Promise<CallToolResult>;

/** 工具名 -> 处理函数 的映射表 */
export type HandlerMap = {
  [toolName: string]: ToolHandler;
};

/** Confluence 页面内容返回结构 */
export interface ConfluencePageResult {
  markdown: string;
  text: string;
  html: string;
  metadata: {
    id: string;
    title: string;
    author: string;
    updated: string;
    url: string;
    spaceKey?: string;
  };
}

/** Confluence 搜索结果项 */
export interface ConfluenceSearchItem {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  spaceKey: string;
  spaceName: string;
  lastModified: string;
  type: string;
}

/** Confluence 空间信息 */
export interface ConfluenceSpace {
  key: string;
  name: string;
  type: string;
  description: string;
  url: string;
}

/** Confluence 子页面信息 */
export interface ConfluenceChildPage {
  id: string;
  title: string;
  url: string;
  status: string;
}
