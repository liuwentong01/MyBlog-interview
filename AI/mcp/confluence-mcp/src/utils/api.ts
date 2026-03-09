import axios, { AxiosInstance } from "axios";
import { Config } from "../types.js";

const TIMEOUT = 15000;

/**
 * 创建一个绑定了认证信息的 Confluence REST API 客户端
 */
export function createApiClient(config: Config): AxiosInstance {
  return axios.create({
    baseURL: `${config.baseUrl}/rest/api`,
    timeout: TIMEOUT,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
  });
}

/**
 * 格式化 Axios 错误为可读字符串
 */
export function formatAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.message;
    if (status === 401) {
      return `认证失败 (401): Token 无效或已过期，请重新获取 Personal Access Token`;
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
