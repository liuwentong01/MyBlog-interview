/**
 * session.js - 会话管理
 *
 * 对应 OpenClaw 架构中的 Session Management，负责：
 * 1. 会话解析 (Session Resolution) — 根据消息来源确定会话 ID
 * 2. 会话持久化 — 以 .jsonl 追加式日志格式存储（同 OpenClaw）
 * 3. 会话压缩 (Compaction) — 历史过长时自动摘要，压缩前做 Memory Flush
 *
 * ===== 会话 Key 格式 =====
 *
 * OpenClaw 的完整格式：agent:{agentId}:{channel}:{peerKind}:{peerId}
 * 会话不仅是聊天标签，也是安全边界：不同类型有不同权限和沙箱规则。
 *
 * ===== 会话解析 (Session Resolution) =====
 *
 * OpenClaw 使用 specificity cascade（特异性级联）来匹配消息到会话：
 *   peer-level → parent-peer → guild-level → team-level → account-level → channel-level → default
 *
 * 简化版实现三种核心场景，已足够演示安全隔离概念。
 *
 * ===== 压缩与 Memory Flush =====
 *
 * OpenClaw 的压缩流程（关键链路）：
 *   触发压缩 → Memory Flush（将重要信息写入记忆系统）→ 生成摘要 → 替换旧消息
 *
 * 这样可以确保压缩不会导致关键信息永久丢失——信息被"转移"到了记忆系统中，
 * 后续对话可以通过语义搜索重新找回。
 */

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');

class SessionManager {
  /**
   * @param {object} config
   * @param {number} config.maxHistoryLength - 触发压缩的消息条数阈值
   * @param {number} config.keepRecentCount - 压缩后保留的最近消息条数
   * @param {MemorySystem} config.memory - 记忆系统引用（用于压缩前的 Memory Flush）
   */
  constructor(config = {}) {
    this.maxHistoryLength = config.maxHistoryLength || 30;
    this.keepRecentCount = config.keepRecentCount || 10;

    /**
     * 记忆系统引用
     *
     * OpenClaw 中 Session 和 Memory 存在关键耦合：
     * 压缩前需要调用 Memory 的 extractFromMessages()，
     * 将即将被丢弃的旧消息中的重要信息"转移"到记忆系统。
     * 这是 OpenClaw 的 "pre-compaction memory flush" 机制。
     */
    this.memory = config.memory || null;

    // 内存中的活跃会话缓存：sessionId -> session
    this._sessions = new Map();

    this._ensureDir();
  }

  /**
   * 会话解析 (Session Resolution)
   *
   * 根据消息的来源信息确定它属于哪个会话。
   *
   * 三种场景：
   *   - peerKind === 'main' → 用户自己发的消息，共享一个 main 会话（最高权限）
   *   - peerKind === 'group' → 群聊消息，按 channel + groupId 隔离
   *   - peerKind === 'dm'   → 别人的私聊，按 channel + senderId 隔离
   *
   * 安全含义：main 会话可以访问所有工具；dm/group 会话可以被限制工具权限。
   *
   * @param {object} message - 收到的消息
   * @returns {string} 会话 ID
   */
  resolveSessionId(message) {
    const { channelType, senderId, peerKind, groupId } = message;

    switch (peerKind) {
      case 'main':
        return 'agent:default:main';
      case 'group':
        return `agent:default:${channelType}:group:${groupId}`;
      case 'dm':
      default:
        return `agent:default:${channelType}:dm:${senderId}`;
    }
  }

  /**
   * 获取或创建会话
   * 先从内存缓存中查找，未命中则从磁盘加载 .jsonl 文件
   */
  getOrCreate(sessionId) {
    if (this._sessions.has(sessionId)) {
      return this._sessions.get(sessionId);
    }
    const session = this._loadFromDisk(sessionId);
    this._sessions.set(sessionId, session);
    return session;
  }

  /**
   * 向会话追加消息
   *
   * OpenClaw 使用 append-only 的 .jsonl 文件，每条记录有 id + parentId 形成树状结构。
   * 简化版直接追加到数组并全量写入（生产环境应该只 append 新行）。
   */
  appendMessage(sessionId, message) {
    const session = this.getOrCreate(sessionId);
    session.history.push(message);
    session.metadata.lastActiveAt = Date.now();
    session.metadata.messageCount++;
    this._saveToDisk(sessionId, session);
  }

  /**
   * 获取会话历史（供上下文组装使用）
   * 如果历史过长，先触发压缩
   */
  getHistory(sessionId) {
    const session = this.getOrCreate(sessionId);
    if (session.history.length > this.maxHistoryLength) {
      this._compact(sessionId, session);
    }
    return session.history;
  }

  /** 获取所有活跃会话的 ID 列表 */
  listSessions() {
    const diskSessions = this._listDiskSessions();
    const memSessions = Array.from(this._sessions.keys());
    return [...new Set([...diskSessions, ...memSessions])];
  }

  /**
   * 会话压缩 (Compaction)
   *
   * OpenClaw 的完整压缩流程：
   *
   *   1. 触发条件：会话消息数接近或超过模型上下文窗口
   *
   *   2. Pre-compaction Memory Flush（关键步骤！）
   *      在丢弃旧消息之前，先调用 memory.extractFromMessages()
   *      将重要信息提取到记忆系统中，防止关键细节永久丢失。
   *      （真实 OpenClaw 会触发一个 silent agentic turn 让 LLM 决定哪些信息值得保留）
   *
   *   3. 生成摘要：将旧消息压缩为一条 summary entry
   *      （真实 OpenClaw 用 LLM 做摘要，简化版用关键词提取）
   *
   *   4. 替换：用 [摘要 + 最近 N 条消息] 替换完整历史
   */
  _compact(sessionId, session) {
    const cutIndex = session.history.length - this.keepRecentCount;
    if (cutIndex <= 0) return;

    const oldMessages = session.history.slice(0, cutIndex);

    // ====== Pre-compaction Memory Flush ======
    // 这是 OpenClaw 的关键设计：压缩前先将重要信息"转移"到记忆系统
    // 这样即使旧消息被丢弃，信息仍然可以通过记忆搜索被后续对话检索到
    if (this.memory) {
      console.log(`[Session] 压缩前 Memory Flush: 提取 ${oldMessages.length} 条旧消息的关键信息`);
      this.memory.extractFromMessages(oldMessages, sessionId);
    }

    // 生成摘要（生产环境中 OpenClaw 会调用 LLM 做摘要）
    const summary = this._generateSummary(oldMessages);

    // 用摘要替换旧消息
    session.history = [
      { role: 'system', content: `[会话历史摘要] ${summary}` },
      ...session.history.slice(cutIndex),
    ];

    this._saveToDisk(sessionId, session);
    console.log(`[Session] 会话 ${sessionId} 已压缩，${oldMessages.length} 条旧消息被摘要`);
  }

  /** 生成历史摘要（简化版用关键词提取，实际应调用 LLM） */
  _generateSummary(messages) {
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .slice(-5);
    const topics = userMessages.join('；');
    return `之前的对话涉及：${topics || '一般闲聊'}`;
  }

  // ========== 持久化：.jsonl 追加式日志格式 ==========
  // OpenClaw 使用 .jsonl (JSON Lines) 格式：每行一个 JSON 对象
  // 第一行是 metadata，后续行是历史消息记录

  _getFilePath(sessionId) {
    const safeName = sessionId.replace(/[/:]/g, '_');
    return path.join(SESSIONS_DIR, `${safeName}.jsonl`);
  }

  _loadFromDisk(sessionId) {
    const filePath = this._getFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return {
        id: sessionId,
        history: [],
        metadata: { createdAt: Date.now(), lastActiveAt: Date.now(), messageCount: 0 },
      };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (!content) {
        return {
          id: sessionId,
          history: [],
          metadata: { createdAt: Date.now(), lastActiveAt: Date.now(), messageCount: 0 },
        };
      }
      const lines = content.split('\n').filter(Boolean);
      const metadata = JSON.parse(lines[0]);
      const history = lines.slice(1).map(line => JSON.parse(line));
      return { id: sessionId, history, metadata };
    } catch (err) {
      console.error(`[Session] 加载会话失败 ${sessionId}:`, err.message);
      return {
        id: sessionId,
        history: [],
        metadata: { createdAt: Date.now(), lastActiveAt: Date.now(), messageCount: 0 },
      };
    }
  }

  _saveToDisk(sessionId, session) {
    const filePath = this._getFilePath(sessionId);
    const lines = [
      JSON.stringify(session.metadata),
      ...session.history.map(msg => JSON.stringify(msg)),
    ];
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  }

  _listDiskSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs
      .readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', '').replace(/_/g, ':'));
  }

  _ensureDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }
}

module.exports = SessionManager;
