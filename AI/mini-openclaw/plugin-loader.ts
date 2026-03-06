/**
 * plugin-loader.js - 插件加载器
 *
 * 对应 OpenClaw 架构中的 Plugin/Extension System，负责：
 * 1. 扫描 extensions/ 目录，自动发现插件
 * 2. 加载插件并注册到工具系统
 * 3. 支持四种插件类型（简化版只实现工具插件）
 *
 * OpenClaw 的插件系统支持四个扩展方向：
 *   - ProviderPlugin：接入自定义 AI 模型
 *   - ToolPlugin：添加自定义工具
 *   - MemoryPlugin：替换记忆存储后端
 *   - ChannelPlugin：添加新的聊天平台
 *
 * 插件代码放在 extensions/ 目录下，系统自动扫描、发现和加载。
 * 每个插件是一个目录，包含 index.js，导出 { name, tools: [...] }
 */

import fs from 'fs';
import path from 'path';
import ToolSystem from './tool-system';
import type { PluginExport, ToolDefinition } from './types';

const EXTENSIONS_DIR = path.join(__dirname, 'extensions');

interface LoadedPluginInfo {
  name: string;
  description: string;
  toolCount: number;
  dir: string;
}

class PluginLoader {
  private _toolSystem: ToolSystem;
  private _plugins: LoadedPluginInfo[];

  constructor(toolSystem: ToolSystem) {
    // 关联的工具系统，加载的工具插件会注册到这里
    this._toolSystem = toolSystem;
    // 已加载的插件列表
    this._plugins = [];
  }

  /**
   * 扫描并加载所有插件
   *
   * 遍历 extensions/ 目录下的子目录，每个子目录视为一个插件。
   * 插件的 index.js 需要导出一个对象，格式如下：
   *
   *   module.exports = {
   *     name: '插件名称',
   *     description: '插件描述',
   *     tools: [
   *       {
   *         name: '工具名',
   *         description: '工具描述',
   *         parameters: { type: 'object', properties: { ... } },
   *         execute: async (args) => '结果字符串'
   *       }
   *     ]
   *   };
   */
  loadPlugins(): number {
    if (!fs.existsSync(EXTENSIONS_DIR)) {
      console.log('[Plugin] extensions/ 目录不存在，跳过插件加载');
      return 0;
    }

    const entries = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true });
    const pluginDirs = entries.filter(e => e.isDirectory());

    for (const dir of pluginDirs) {
      this._loadPlugin(dir.name);
    }

    console.log(`[Plugin] 插件加载完成，共加载 ${this._plugins.length} 个插件`);
    return this._plugins.length;
  }

  /** 获取已加载插件列表 */
  getPlugins(): LoadedPluginInfo[] {
    return [...this._plugins];
  }

  /**
   * 加载单个插件
   *
   * OpenClaw 的插件加载流程：
   * 1. 读取插件目录下的 index.js
   * 2. 验证导出格式
   * 3. 将工具注册到 ToolSystem
   * 4. 记录插件信息
   */
  private _loadPlugin(dirName: string): void {
    const pluginPath = path.join(EXTENSIONS_DIR, dirName, 'index.js');

    if (!fs.existsSync(pluginPath)) {
      console.warn(`[Plugin] ${dirName}/ 缺少 index.js，跳过`);
      return;
    }

    try {
      const plugin = require(pluginPath) as PluginExport;

      if (!plugin.name) {
        console.warn(`[Plugin] ${dirName}/ 缺少 name 字段，跳过`);
        return;
      }

      // 注册插件工具
      if (Array.isArray(plugin.tools)) {
        for (const tool of plugin.tools) {
          this._toolSystem.register(tool);
          console.log(`[Plugin] 注册工具: ${tool.name} (来自插件 ${plugin.name})`);
        }
      }

      this._plugins.push({
        name: plugin.name,
        description: plugin.description || '',
        toolCount: plugin.tools?.length || 0,
        dir: dirName,
      });

      console.log(`[Plugin] 加载插件: ${plugin.name}`);
    } catch (err) {
      console.error(`[Plugin] 加载 ${dirName} 失败:`, (err as Error).message);
    }
  }
}

export default PluginLoader;
