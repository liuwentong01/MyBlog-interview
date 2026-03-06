/**
 * prompt-builder.js - 系统提示词组装器
 *
 * 对应 OpenClaw 架构中的 System Prompt Architecture，负责：
 * 1. 读取工作空间中的配置文件（AGENTS.md、SOUL.md、TOOLS.md、USER.md 等）
 * 2. 注入动态上下文（记忆搜索结果、运行时信息）
 * 3. 拼装完整的系统提示词
 *
 * ===== 可组合式设计 =====
 *
 * OpenClaw 的系统提示词不是一个写死的字符串，而是由多个来源动态拼装：
 *
 *   第一层：工作空间配置文件（每轮从磁盘读取，修改后立即生效）
 *     - AGENTS.md  — 核心指令，定义 Agent 能做什么、不能做什么
 *     - SOUL.md    — 人格和语气指导，Agent 说话的风格
 *     - TOOLS.md   — 工具使用备注
 *     - USER.md    — 用户画像和偏好
 *     - IDENTITY.md — Agent 的名字和身份（简化版未实现）
 *
 *   第二层：动态上下文（每轮实时组装）
 *     - 记忆搜索结果 — 从记忆系统中检索的语义相关历史片段
 *     - 技能文件 (Skills) — 特定任务的操作指南（简化版未实现）
 *
 *   第三层：运行时信息
 *     - 当前时间、可用工具列表、会话 ID 等
 *
 * ===== 关键设计决策 =====
 *
 * 1. 每轮对话从磁盘重新读取文件（而非启动时缓存）
 *    → 改了 AGENTS.md 不需要重启就能生效
 *    → 这是 OpenClaw "编辑文件即改变行为" 理念的核心支撑
 *
 * 2. 文件有字符上限（单文件 20,000 字符，总计 150,000 字符）
 *    → 防止过长的配置文件撑爆 LLM 上下文窗口
 *
 * 3. 智能筛选：只注入当前对话需要的内容
 *    → 避免提示词太长导致 AI 表现下降（简化版未实现精细筛选）
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = path.join(__dirname, 'workspace');

// 单文件最大字符数（对应 OpenClaw 的 agents.defaults.bootstrapMaxChars = 20000）
const MAX_FILE_CHARS = 20000;
// 总注入字符上限
const MAX_TOTAL_CHARS = 150000;

class PromptBuilder {
  /**
   * 组装完整的系统提示词
   *
   * 每轮对话调用一次，每次都从磁盘重新读取工作空间文件。
   * 这样用户修改 AGENTS.md / SOUL.md 等文件后，下一轮对话立即生效。
   *
   * @param {object} context
   * @param {Array} context.memories - 记忆系统检索到的相关记忆
   * @param {string[]} context.toolNames - 可用工具名称列表
   * @param {string} context.sessionId - 当前会话 ID
   * @returns {string} 完整的系统提示词
   */
  build(context = {}) {
    // ====== 每轮都从磁盘读取最新的工作空间文件 ======
    // 这是 OpenClaw 的核心设计：改文件即改行为，无需重启
    const workspaceFiles = this._loadWorkspaceFiles();

    const sections = [];
    let totalChars = 0;

    // === 第一层：工作空间配置文件 ===

    // AGENTS.md — 核心指令（最重要，优先加载）
    const agents = workspaceFiles['AGENTS.md'];
    if (agents) {
      sections.push(`## 核心指令\n${agents}`);
      totalChars += agents.length;
    }

    // SOUL.md — 人格和语气
    const soul = workspaceFiles['SOUL.md'];
    if (soul && totalChars + soul.length < MAX_TOTAL_CHARS) {
      sections.push(`## 人格设定\n${soul}`);
      totalChars += soul.length;
    }

    // USER.md — 用户信息
    const user = workspaceFiles['USER.md'];
    if (user && totalChars + user.length < MAX_TOTAL_CHARS) {
      sections.push(`## 用户信息\n${user}`);
      totalChars += user.length;
    }

    // TOOLS.md — 工具使用备注
    const tools = workspaceFiles['TOOLS.md'];
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

  /**
   * 从磁盘读取工作空间中的所有 .md 文件
   *
   * 每次调用都重新读取，保证获取最新内容。
   * 这是 OpenClaw "编辑文件即改变行为" 的实现基础。
   *
   * @returns {object} filename -> content 的映射
   */
  _loadWorkspaceFiles() {
    const files = {};

    if (!fs.existsSync(WORKSPACE_DIR)) {
      console.warn(`[PromptBuilder] 工作空间目录不存在: ${WORKSPACE_DIR}`);
      return files;
    }

    const entries = fs.readdirSync(WORKSPACE_DIR).filter(f => f.endsWith('.md'));
    for (const entry of entries) {
      try {
        let content = fs.readFileSync(path.join(WORKSPACE_DIR, entry), 'utf-8');
        // 按 OpenClaw 的规则截断过长的文件
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + '\n... (内容已截断)';
        }
        files[entry] = content;
      } catch (err) {
        console.error(`[PromptBuilder] 读取 ${entry} 失败:`, err.message);
      }
    }

    return files;
  }
}

module.exports = PromptBuilder;
