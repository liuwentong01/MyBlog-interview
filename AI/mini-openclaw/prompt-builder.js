/**
 * prompt-builder.js - 系统提示词组装器
 *
 * 对应 OpenClaw 架构中的 System Prompt Architecture，负责：
 * 1. 读取工作空间中的配置文件（AGENTS.md、SOUL.md、TOOLS.md、USER.md 等）
 * 2. 注入动态上下文（记忆搜索结果、会话历史）
 * 3. 拼装完整的系统提示词
 *
 * OpenClaw 的系统提示词是可组合的，由多个来源拼装而成：
 *   - 工作空间配置文件 (AGENTS.md, SOUL.md, TOOLS.md, USER.md, IDENTITY.md)
 *   - 动态上下文 (记忆、技能、会话历史)
 *   - 工具定义 (自动生成)
 *
 * 关键设计：只需编辑工作空间文件就能改变 Agent 的行为，不用改源代码。
 * Bootstrap 文件有字符上限（单文件 20,000 字符，总计 150,000 字符）。
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = path.join(__dirname, 'workspace');

// 单文件最大字符数（对应 OpenClaw 的 agents.defaults.bootstrapMaxChars = 20000）
const MAX_FILE_CHARS = 20000;
// 总注入字符上限
const MAX_TOTAL_CHARS = 150000;

class PromptBuilder {
  constructor() {
    // 缓存工作空间文件（启动时加载一次）
    this._workspaceFiles = {};
    this._loadWorkspaceFiles();
  }

  /**
   * 组装完整的系统提示词
   *
   * OpenClaw 每轮对话都会重新组装 system prompt，包含：
   * 1. 基线指令 (AGENTS.md) - 定义 Agent 能做什么、不能做什么
   * 2. 人格设定 (SOUL.md) - Agent 说话的风格和语气
   * 3. 工具说明 (TOOLS.md) - 工具使用备注
   * 4. 用户信息 (USER.md) - 用户画像和偏好
   * 5. 相关记忆 - 从记忆系统中检索的历史片段
   * 6. 运行时信息 - 当前时间、可用工具列表等
   *
   * @param {object} context - { memories: Array, toolNames: string[], sessionId: string }
   * @returns {string} 完整的系统提示词
   */
  build(context = {}) {
    const sections = [];
    let totalChars = 0;

    // === 第一层：工作空间配置文件 ===

    // AGENTS.md - 核心指令（最重要，优先加载）
    const agents = this._getFile('AGENTS.md');
    if (agents) {
      sections.push(`## 核心指令\n${agents}`);
      totalChars += agents.length;
    }

    // SOUL.md - 人格和语气
    const soul = this._getFile('SOUL.md');
    if (soul && totalChars + soul.length < MAX_TOTAL_CHARS) {
      sections.push(`## 人格设定\n${soul}`);
      totalChars += soul.length;
    }

    // USER.md - 用户信息
    const user = this._getFile('USER.md');
    if (user && totalChars + user.length < MAX_TOTAL_CHARS) {
      sections.push(`## 用户信息\n${user}`);
      totalChars += user.length;
    }

    // TOOLS.md - 工具使用备注
    const tools = this._getFile('TOOLS.md');
    if (tools && totalChars + tools.length < MAX_TOTAL_CHARS) {
      sections.push(`## 工具使用说明\n${tools}`);
      totalChars += tools.length;
    }

    // === 第二层：动态上下文 ===

    // 相关记忆（由记忆系统语义搜索得到）
    if (context.memories && context.memories.length > 0) {
      const memoryText = context.memories
        .map(m => `- ${m.content} (${new Date(m.timestamp).toLocaleString('zh-CN')})`)
        .join('\n');
      sections.push(`## 相关记忆\n${memoryText}`);
    }

    // === 第三层：运行时信息 ===

    const runtime = [
      `当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      `会话 ID：${context.sessionId || '未知'}`,
      `可用工具：${(context.toolNames || []).join(', ') || '无'}`,
    ].join('\n');
    sections.push(`## 运行时信息\n${runtime}`);

    return sections.join('\n\n');
  }

  /** 重新加载工作空间文件（配置热更新） */
  reload() {
    this._workspaceFiles = {};
    this._loadWorkspaceFiles();
    console.log('[PromptBuilder] 工作空间配置文件已重新加载');
  }

  // ========== 内部方法 ==========

  /**
   * 加载工作空间中的所有 .md 文件
   * OpenClaw 在每轮对话前都会读取这些文件
   */
  _loadWorkspaceFiles() {
    if (!fs.existsSync(WORKSPACE_DIR)) {
      console.warn(`[PromptBuilder] 工作空间目录不存在: ${WORKSPACE_DIR}`);
      return;
    }

    const files = fs.readdirSync(WORKSPACE_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        let content = fs.readFileSync(path.join(WORKSPACE_DIR, file), 'utf-8');
        // 按 OpenClaw 的规则截断过长的文件
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + '\n... (内容已截断)';
        }
        this._workspaceFiles[file] = content;
      } catch (err) {
        console.error(`[PromptBuilder] 读取 ${file} 失败:`, err.message);
      }
    }
  }

  _getFile(name) {
    return this._workspaceFiles[name] || null;
  }
}

module.exports = PromptBuilder;
