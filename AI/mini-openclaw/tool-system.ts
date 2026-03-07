/**
 * tool-system.js - 工具系统
 *
 * 对应 OpenClaw 架构中的 Tool System，负责：
 * 1. 工具的注册与管理（类似 OpenClaw 的 60+ 内置工具）
 * 2. 工具定义生成（供 LLM 理解可用工具）
 * 3. 工具执行与结果格式化
 *
 * OpenClaw 的工具分为内置工具（shell、browser、file 等）和插件工具。
 * 这里我们实现内置的 shell、file、time 三种工具作为演示。
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { ToolDefinition, LLMToolDefinition } from "./types";

class ToolSystem {
  private _tools: Map<string, ToolDefinition>;

  constructor() {
    // 工具注册表：name -> { name, description, parameters, execute }
    this._tools = new Map<string, ToolDefinition>();

    // 注册内置工具
    this._registerBuiltinTools();
  }

  /**
   * 注册一个工具
   * OpenClaw 中工具通过 ToolPlugin 接口注册，
   * 每个工具需要提供名称、描述、参数 schema 和执行函数
   */
  register(toolDef: ToolDefinition): void {
    if (!toolDef.name || !toolDef.execute) {
      throw new Error(`工具定义不完整，需要 name 和 execute: ${JSON.stringify(toolDef)}`);
    }
    this._tools.set(toolDef.name, toolDef);
  }

  /** 注销一个工具 */
  unregister(name: string): void {
    this._tools.delete(name);
  }

  /** 获取所有已注册工具的名称 */
  getToolNames(): string[] {
    return Array.from(this._tools.keys());
  }

  /**
   * 生成工具定义列表（供 LLM 使用）
   * 格式参照 OpenAI function calling 的 tools 格式，
   * OpenClaw 也采用类似格式让 LLM 知道有哪些工具可用
   */
  getToolDefinitions(): LLMToolDefinition[] {
    return Array.from(this._tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: "object", properties: {} },
      },
    }));
  }

  /**
   * 执行工具调用
   * OpenClaw 的 Agent 在收到 LLM 的工具调用请求后，
   * 通过 ToolSystem 执行工具并将结果回传给 LLM
   *
   * @param {string} name - 工具名
   * @param {object} args - 工具参数
   * @returns {Promise<string>} 执行结果（文本）
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this._tools.get(name);
    if (!tool) {
      return `错误：未找到工具 "${name}"，可用工具：${this.getToolNames().join(", ")}`;
    }
    try {
      const result = await tool.execute(args);
      return String(result);
    } catch (err) {
      return `工具 "${name}" 执行出错：${(err as Error).message}`;
    }
  }

  /**
   * 注册内置工具
   * OpenClaw 内置了 shell、browser、file 等工具，
   * 这里我们实现三个最核心的：时间、文件操作、Shell 命令
   */
  _registerBuiltinTools(): void {
    // ========== 工具 1: 获取当前时间 ==========
    this.register({
      name: "get_current_time",
      description: "获取当前日期和时间",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const now = new Date();
        return `当前时间：${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`;
      },
    });

    // ========== 工具 2: 列出目录文件 ==========
    this.register({
      name: "list_files",
      description: "列出指定目录下的文件和文件夹",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径，默认为当前目录" },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        const targetPath = (args.path as string) || ".";
        const resolved = path.resolve(targetPath);
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const lines = entries.map((e) => {
          const icon = e.isDirectory() ? "📁" : "📄";
          return `${icon} ${e.name}`;
        });
        return `目录 ${resolved} 的内容：\n${lines.join("\n")}`;
      },
    });

    // ========== 工具 3: 读取文件 ==========
    this.register({
      name: "read_file",
      description: "读取指定文件的内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          maxLines: { type: "number", description: "最多读取行数，默认 50" },
        },
        required: ["path"],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = path.resolve(args.path as string);
        if (!fs.existsSync(filePath)) {
          return `文件不存在：${filePath}`;
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const maxLines = (args.maxLines as number) || 50;
        const truncated = lines.length > maxLines;
        const output = lines.slice(0, maxLines).join("\n");
        return truncated
          ? `文件 ${filePath} 的内容（前 ${maxLines} 行）：\n${output}\n... (共 ${lines.length} 行)`
          : `文件 ${filePath} 的内容：\n${output}`;
      },
    });

    // ========== 工具 4: 执行 Shell 命令 ==========
    // OpenClaw 中 Shell 工具可在 Docker 沙箱中运行，这里简化为直接执行
    this.register({
      name: "run_shell",
      description: "执行一条 Shell 命令并返回输出",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
        },
        required: ["command"],
      },
      execute: async (args: Record<string, unknown>) => {
        const cmd = args.command as string;
        // 安全限制：禁止危险命令
        const dangerous = ["rm -rf", "mkfs", "dd if=", ":(){", "fork bomb"];
        if (dangerous.some((d) => cmd.includes(d))) {
          return "安全限制：禁止执行危险命令";
        }
        try {
          const output = execSync(cmd, {
            encoding: "utf-8",
            timeout: 10000, // 10 秒超时
            maxBuffer: 1024 * 1024,
          });
          return `命令 \`${cmd}\` 的输出：\n${output.trim() || "(无输出)"}`;
        } catch (err) {
          return `命令执行失败：${(err as Error).message}`;
        }
      },
    });
  }
}

export default ToolSystem;
