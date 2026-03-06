/**
 * memory.js - 记忆系统
 *
 * 对应 OpenClaw 架构中的 Memory System，负责：
 * 1. 长期记忆存储 - 保存重要的对话片段和用户偏好
 * 2. 记忆检索 - 根据当前对话搜索相关记忆（OpenClaw 用语义搜索/向量数据库）
 * 3. 会话压缩前的记忆提取 (pre-compaction memory flush)
 *
 * OpenClaw 的记忆系统支持通过 MemoryPlugin 替换存储后端（如向量数据库）。
 * 默认使用文件存储，记忆写入 MEMORY.md 和 memory/YYYY-MM-DD.md 等文件。
 *
 * 简化版：使用 JSON 文件存储 + 关键词匹配搜索（替代向量相似度搜索）
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(__dirname, 'data', 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memories.json');

class MemorySystem {
  constructor() {
    this._memories = [];
    this._ensureDir();
    this._load();
  }

  /**
   * 保存一条记忆
   *
   * OpenClaw 的记忆条目包含：内容、时间戳、关联的会话 ID、标签等。
   * Agent 在对话过程中会主动将重要信息存入记忆系统。
   *
   * @param {object} entry - { content: string, sessionId: string, tags?: string[] }
   */
  save(entry) {
    const memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: entry.content,
      sessionId: entry.sessionId || 'unknown',
      tags: entry.tags || [],
      timestamp: Date.now(),
    };
    this._memories.push(memory);
    this._persist();
    return memory;
  }

  /**
   * 搜索相关记忆
   *
   * OpenClaw 使用语义搜索（embedding + 向量相似度）来找到与当前对话相关的记忆。
   * 简化版使用关键词匹配：将查询分词后，计算每条记忆的匹配分数。
   *
   * @param {string} query - 搜索查询
   * @param {number} topK - 返回前 K 条最相关的记忆
   * @returns {Array} 相关记忆列表
   */
  search(query, topK = 3) {
    if (this._memories.length === 0) return [];

    // 简化版的相关性搜索：基于关键词匹配
    const keywords = this._tokenize(query);

    const scored = this._memories.map(mem => {
      const memTokens = this._tokenize(mem.content);
      // 计算关键词重叠度
      const overlap = keywords.filter(kw => memTokens.includes(kw)).length;
      const score = keywords.length > 0 ? overlap / keywords.length : 0;
      return { memory: mem, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.memory);
  }

  /**
   * 压缩前的记忆提取 (Pre-compaction memory flush)
   *
   * OpenClaw 在压缩会话历史前，会触发一个 silent agentic turn，
   * 提醒 LLM 将重要信息写入记忆系统，防止关键细节在压缩中丢失。
   *
   * 简化版：从即将被压缩的消息中提取用户消息作为记忆
   */
  extractFromMessages(messages, sessionId) {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return;

    const content = userMessages.map(m => m.content).join(' | ');
    this.save({
      content: `历史对话摘要：${content}`,
      sessionId,
      tags: ['auto-extract', 'compaction'],
    });
  }

  /** 获取所有记忆（调试用） */
  getAll() {
    return [...this._memories];
  }

  // ========== 简易分词（中英文混合） ==========
  _tokenize(text) {
    // 英文按空格分词，中文按双字滑窗分词（简化版的 bigram 分词）
    const tokens = [];
    const cleaned = text.toLowerCase();

    // 提取英文单词
    const englishWords = cleaned.match(/[a-z0-9]+/g) || [];
    tokens.push(...englishWords.filter(w => w.length > 1));

    // 提取中文并做双字滑窗（例如 "你好世界" → ["你好", "好世", "世界"]）
    const chineseChars = cleaned.match(/[\u4e00-\u9fff]+/g) || [];
    for (const segment of chineseChars) {
      if (segment.length === 1) {
        tokens.push(segment);
      } else {
        for (let i = 0; i < segment.length - 1; i++) {
          tokens.push(segment.slice(i, i + 2));
        }
      }
    }

    return tokens;
  }

  // ========== 持久化 ==========
  _load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        this._memories = JSON.parse(data);
      }
    } catch (err) {
      console.error('[Memory] 加载记忆失败:', err.message);
      this._memories = [];
    }
  }

  _persist() {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(this._memories, null, 2), 'utf-8');
  }

  _ensureDir() {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
  }
}

module.exports = MemorySystem;
