/**
 * session.js - 会话管理
 *
 * 对应 OpenClaw 架构中的 Session Management，负责：
 * 1. 会话解析 (Session Resolution) - 根据消息来源确定会话 ID
 * 2. 会话持久化 - 以 .jsonl 追加式日志格式存储（同 OpenClaw）
 * 3. 会话压缩 (Compaction) - 历史过长时自动摘要
 *
 * OpenClaw 的会话 key 格式：agent:{agentId}:{channel}:{peerKind}:{peerId}
 * 会话不仅是标签，也是安全边界：不同类型有不同权限和沙箱规则
 */

const fs = require('fs');
const path = require('path');

// 会话存储目录
const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');

class SessionManager {
  constructor(config = {}) {
    // 单个会话最大消息条数，超过后触发压缩
    this.maxHistoryLength = config.maxHistoryLength || 30;
    // 压缩后保留的最近消息条数
    this.keepRecentCount = config.keepRecentCount || 10;

    // 内存中的活跃会话缓存：sessionId -> session
    this._sessions = new Map();

    this._ensureDir();
  }

  /**
   * 会话解析 (Session Resolution)
   *
   * OpenClaw 通过 specificity cascade 来匹配消息到会话：
   *   peer-level → parent-peer → guild-level → team-level → account-level → channel-level → default
   *
   * 简化版只实现三种场景：
   *   - 自己发的消息 → main 会话（最高权限）
   *   - 别人的私聊 → dm:{channel}:{senderId}
   *   - 群聊 → group:{channel}:{groupId}
   *
   * @param {object} message - 收到的消息
   * @returns {string} 会话 ID
   */
  resolveSessionId(message) {
    const { channelType, senderId, peerKind, groupId } = message;

    switch (peerKind) {
      case 'main':
        // 用户自己发的消息共享一个 main 会话，权限最高
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
   * 先从内存缓存中查找，未命中则从磁盘加载
   */
  getOrCreate(sessionId) {
    if (this._sessions.has(sessionId)) {
      return this._sessions.get(sessionId);
    }

    // 尝试从磁盘加载
    const session = this._loadFromDisk(sessionId);
    this._sessions.set(sessionId, session);
    return session;
  }

  /**
   * 向会话追加消息
   * OpenClaw 使用 append-only 的 .jsonl 文件，每条记录有 id + parentId 形成树状结构
   * 简化版直接追加到数组
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

    // 检查是否需要压缩
    if (session.history.length > this.maxHistoryLength) {
      this._compact(sessionId, session);
    }

    return session.history;
  }

  /** 获取所有活跃会话的 ID 列表 */
  listSessions() {
    // 合并内存中的和磁盘上的
    const diskSessions = this._listDiskSessions();
    const memSessions = Array.from(this._sessions.keys());
    return [...new Set([...diskSessions, ...memSessions])];
  }

  /**
   * 会话压缩 (Compaction)
   *
   * OpenClaw 的压缩机制：
   * 1. 触发条件：会话接近或超过模型上下文窗口
   * 2. 压缩前会先做 memory flush（将重要信息写入记忆系统）
   * 3. 将旧消息摘要为一条 summary entry
   * 4. 保留最近的消息不动
   *
   * 简化版：将超出部分的消息合并为一条摘要
   */
  _compact(sessionId, session) {
    const cutIndex = session.history.length - this.keepRecentCount;
    if (cutIndex <= 0) return;

    const oldMessages = session.history.slice(0, cutIndex);

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
      .slice(-5); // 取最后 5 条用户消息
    const topics = userMessages.join('；');
    return `之前的对话涉及：${topics || '一般闲聊'}`;
  }

  // ========== 持久化：.jsonl 格式 ==========

  _getFilePath(sessionId) {
    // 将 session ID 中的特殊字符替换为安全的文件名
    const safeName = sessionId.replace(/[/:]/g, '_');
    return path.join(SESSIONS_DIR, `${safeName}.jsonl`);
  }

  /** 从磁盘加载会话 */
  _loadFromDisk(sessionId) {
    const filePath = this._getFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return {
        id: sessionId,
        history: [],
        metadata: {
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          messageCount: 0,
        },
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
      // 第一行是 metadata，后续是 history entries
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

  /** 保存会话到磁盘（全量写入，生产环境应该用 append） */
  _saveToDisk(sessionId, session) {
    const filePath = this._getFilePath(sessionId);
    const lines = [
      JSON.stringify(session.metadata),
      ...session.history.map(msg => JSON.stringify(msg)),
    ];
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  }

  /** 列出磁盘上的会话文件 */
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
