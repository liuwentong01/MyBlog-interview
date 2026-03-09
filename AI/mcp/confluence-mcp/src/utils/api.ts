import axios, { AxiosInstance } from "axios";
import { Config } from "../types.js";

const TIMEOUT = 15000;

/**
 * 创建一个绑定了认证信息的 Confluence REST API 客户端
 * 支持两种认证方式：
 *   1. Bearer Token（直连 Confluence，无 SSO 拦截时）
 *   2. Cookie（SSO 环境下，从浏览器复制 Cookie）
 */
export function createApiClient(config: Config): AxiosInstance {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (config.cookie) {
    headers["Cookie"] = config.cookie;
  } else if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  return axios.create({
    baseURL: `${config.baseUrl}/rest/api`,
    timeout: TIMEOUT,
    headers,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

/**
 * 格式化 Axios 错误为可读字符串
 */
export function formatAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.message;
    if (status === 302) {
      return `被重定向到 SSO 登录页 (302): 请使用 --cookie 参数传入浏览器 Cookie，或确保 Token 有效`;
    }
    if (status === 401) {
      return `认证失败 (401): Token 或 Cookie 无效/已过期`;
    }
    if (status === 403) {
      return `权限不足 (403): 当前用户无权访问该资源`;
    }
    if (status === 404) {
      return `资源不存在 (404): 请确认页面 ID 或 URL 是否正确`;
    }
    return `请求失败: ${status} - ${msg}`;
  }
  return `错误: ${error instanceof Error ? error.message : String(error)}`;
}
