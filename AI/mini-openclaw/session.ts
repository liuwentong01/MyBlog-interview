/**
 * session.js - 会话管理
 *
 * 对应 OpenClaw 架构中的 Session Management，负责：
 * 1. 会话解析 (Session Resolution) — 根据消息来源确定会话 ID
 * 2. 会话持久化 — 以 .jsonl 追加式日志格式存储（同 OpenClaw）
 * 3. 会话压缩 (Compaction) — 历史过长时自动摘要，压缩前做 Memory Flush
 *
 * ===== 整体流程图 =====
 *
 *  外部调用方（Agent）
 *       │
 *       │  收到一条 IncomingMessage
 *       │
 *       ▼
 *  ┌───────────────────────────────────────────────────────────┐
 *  │              resolveSessionId()                           │ ← 会话解析
 *  │                                                           │
 *  │   根据 peerKind 决定会话 ID（也就是安全边界）：              │
 *  │                                                           │
 *  │   peerKind     │ 会话 ID 格式                 │ 权限       │
 *  │   ─────────────┼─────────────────────────────┼──────      │
 *  │   "main"       │ agent:default:main          │ 最高       │
 *  │   "dm"         │ agent:default:web:dm:uid123 │ 受限       │
 *  │   "group"      │ agent:default:tg:group:g456 │ 受限       │
 *  │                                                           │
 *  └──────────────────────┬────────────────────────────────────┘
 *                         │ sessionId
 *                         ▼
 *  ┌───────────────────────────────────────────────────────────┐
 *  │              getOrCreate(sessionId)                        │ ← 获取/创建会话
 *  │                                                           │
 *  │   _sessions (内存缓存)                                     │
 *  │       │                                                   │
 *  │       ├─ 命中 → 直接返回 Session 对象                      │
 *  │       │                                                   │
 *  │       └─ 未命中 → _loadFromDisk()                         │
 *  │                    │                                      │
 *  │                    ▼                                      │
 *  │              .jsonl 文件                                   │
 *  │              ┌──────────────────────────────┐             │
 *  │              │ 第1行: { metadata }          │             │
 *  │              │ 第2行: { role, content }     │  ← 消息记录  │
 *  │              │ 第3行: { role, content }     │             │
 *  │              │ ...                          │             │
 *  │              └──────────────────────────────┘             │
 *  │              文件不存在 → 创建空 Session                    │
 *  │                                                           │
 *  └──────────────────────┬────────────────────────────────────┘
 *                         │ Session { id, history[], metadata }
 *                         ▼
 *  ┌───────────────────────────────────────────────────────────┐
 *  │              appendMessage(sessionId, msg)                 │ ← 追加消息
 *  │                                                           │
 *  │   session.history.push(msg)                               │
 *  │   session.metadata.messageCount++                         │
 *  │   _saveToDisk() → 全量写入 .jsonl                         │
 *  │                                                           │
 *  └──────────────────────┬────────────────────────────────────┘
 *                         │
 *                         ▼
 *  ┌───────────────────────────────────────────────────────────┐
 *  │              getHistory(sessionId)                         │ ← 读取历史
 *  │                                                           │   （Agent 组装上下文时调用）
 *  │   history.length > maxHistoryLength(30)?                  │
 *  │       │                                                   │
 *  │       ├─ 否 → 直接返回 history                             │
 *  │       │                                                   │
 *  │       └─ 是 → 触发压缩 _compact()                         │
 *  │                │                                          │
 *  └────────────────┼──────────────────────────────────────────┘
 *                   │
 *                   ▼
 *  ┌───────────────────────────────────────────────────────────┐
 *  │              _compact() — 会话压缩                         │
 *  │                                                           │
 *  │   假设 history 有 35 条，keepRecentCount = 10              │
 *  │   cutIndex = 35 - 10 = 25（前 25 条将被压缩）              │
 *  │                                                           │
 *  │   Step 1: Pre-compaction Memory Flush                     │
 *  │       │                                                   │
 *  │       ▼                                                   │
 *  │   memory.extractFromMessages(oldMessages)                 │
 *  │   将前 25 条中的重要信息 ──►  MemorySystem                 │
 *  │   （防止关键细节永久丢失）      ┌──────────┐               │
 *  │                                │ 记忆存储  │               │
 *  │                                │ 可被后续  │               │
 *  │                                │ 语义搜索  │               │
 *  │                                └──────────┘               │
 *  │                                                           │
 *  │   Step 2: _generateSummary(oldMessages)                   │
 *  │       提取旧消息关键词，生成摘要文本                         │
 *  │                                                           │
 *  │   Step 3: 替换历史                                         │
 *  │       之前: [msg1, msg2, ..., msg25, msg26, ..., msg35]   │
 *  │       之后: [摘要, msg26, msg27, ..., msg35]               │
 *  │              ↑                  └── 保留最近 10 条 ──┘     │
 *  │              └── "[会话历史摘要] 之前的对话涉及：..."        │
 *  │                                                           │
 *  │   Step 4: _saveToDisk() 持久化                             │
 *  │                                                           │
 *  └───────────────────────────────────────────────────────────┘
 *
 * ===== 持久化格式 (.jsonl) =====
 *
 *   文件名: data/sessions/agent_default_web_dm_uid123.jsonl
 *   ┌────────────────────────────────────────────────────────┐
 *   │ {"createdAt":1741405200000,"lastActiveAt":...,"messageCount":5}  ← 第1行: metadata
 *   │ {"role":"user","content":"你好"}                                  ← 第2行起: 消息
 *   │ {"role":"assistant","content":"你好！有什么可以帮你的？"}
 *   │ {"role":"user","content":"今天天气怎么样"}
 *   │ {"role":"assistant","content":"...","toolCalls":[...]}
 *   │ ...
 *   └────────────────────────────────────────────────────────┘
 *

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

import fs from "fs";
import path from "path";
import type { Session, SessionMetadata, ChatMessage } from "./types";
import MemorySystem from "./memory";

const SESSIONS_DIR = path.join(__dirname, "data", "sessions");

class SessionManager {
  maxHistoryLength: number;
  keepRecentCount: number;
  memory: MemorySystem | null;
  private _sessions: Map<string, Session>;

  /**
   * @param {object} config
   * @param {number} config.maxHistoryLength - 触发压缩的消息条数阈值
   * @param {number} config.keepRecentCount - 压缩后保留的最近消息条数
   * @param {MemorySystem} config.memory - 记忆系统引用（用于压缩前的 Memory Flush）
   */
  constructor(
    config: {
      maxHistoryLength?: number;
      keepRecentCount?: number;
      memory?: MemorySystem;
    } = {},
  ) {
    this.maxHistoryLength = config.maxHistoryLength ?? 30;
    this.keepRecentCount = config.keepRecentCount ?? 10;

    /**
     * 记忆系统引用
     *
     * OpenClaw 中 Session 和 Memory 存在关键耦合：
     * 压缩前需要调用 Memory 的 extractFromMessages()，
     * 将即将被丢弃的旧消息中的重要信息"转移"到记忆系统。
     * 这是 OpenClaw 的 "pre-compaction memory flush" 机制。
     */
    this.memory = config.memory ?? null;

    // 内存中的活跃会话缓存：sessionId -> session
    this._sessions = new Map<string, Session>();

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
  resolveSessionId(message: {
    channelType: string;
    senderId: string;
    peerKind: string;
    groupId?: string | null;
  }): string {
    const { channelType, senderId, peerKind, groupId } = message;

    switch (peerKind) {
      case "main":
        return "agent:default:main";
      case "group":
        return `agent:default:${channelType}:group:${groupId}`;
      case "dm":
      default:
        return `agent:default:${channelType}:dm:${senderId}`;
    }
  }

  /**
   * 获取或创建会话
   * 先从内存缓存中查找，未命中则从磁盘加载 .jsonl 文件
   */
  getOrCreate(sessionId: string): Session {
    if (this._sessions.has(sessionId)) {
      return this._sessions.get(sessionId)!;
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
  appendMessage(sessionId: string, message: ChatMessage): void {
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
  getHistory(sessionId: string): ChatMessage[] {
    const session = this.getOrCreate(sessionId);
    if (session.history.length > this.maxHistoryLength) {
      this._compact(sessionId, session);
    }
    return session.history;
  }

  /** 获取所有活跃会话的 ID 列表 */
  listSessions(): string[] {
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
  private _compact(sessionId: string, session: Session): void {
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
    session.history = [{ role: "system", content: `[会话历史摘要] ${summary}` }, ...session.history.slice(cutIndex)];

    this._saveToDisk(sessionId, session);
    console.log(`[Session] 会话 ${sessionId} 已压缩，${oldMessages.length} 条旧消息被摘要`);
  }

  /** 生成历史摘要（简化版用关键词提取，实际应调用 LLM） */
  private _generateSummary(messages: ChatMessage[]): string {
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .slice(-5);
    const topics = userMessages.join("；");
    return `之前的对话涉及：${topics || "一般闲聊"}`;
  }

  // ========== 持久化：.jsonl 追加式日志格式 ==========
  // OpenClaw 使用 .jsonl (JSON Lines) 格式：每行一个 JSON 对象
  // 第一行是 metadata，后续行是历史消息记录

  private _getFilePath(sessionId: string): string {
    const safeName = sessionId.replace(/[/:]/g, "_");
    return path.join(SESSIONS_DIR, `${safeName}.jsonl`);
  }

  private _loadFromDisk(sessionId: string): Session {
    const filePath = this._getFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return {
        id: sessionId,
        history: [],
        metadata: { createdAt: Date.now(), lastActiveAt: Date.now(), messageCount: 0 },
      };
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (!content) {
        return {
          id: sessionId,
          history: [],
          metadata: { createdAt: Date.now(), lastActiveAt: Date.now(), messageCount: 0 },
        };
      }
      const lines = content.split("\n").filter(Boolean);
      const metadata = JSON.parse(lines[0]) as SessionMetadata;
      const history = lines.slice(1).map((line) => JSON.parse(line) as ChatMessage);
      return { id: sessionId, history, metadata };
    } catch (err) {
      console.error(`[Session] 加载会话失败 ${sessionId}:`, (err as Error).message);
      return {
        id: sessionId,
        history: [],
        metadata: { createdAt: Date.now(), lastActiveAt: Date.now(), messageCount: 0 },
      };
    }
  }

  private _saveToDisk(sessionId: string, session: Session): void {
    const filePath = this._getFilePath(sessionId);
    const lines = [JSON.stringify(session.metadata), ...session.history.map((msg) => JSON.stringify(msg))];
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  }

  private _listDiskSessions(): string[] {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", "").replace(/_/g, ":"));
  }

  private _ensureDir(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }
}

export default SessionManager;
