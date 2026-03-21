# 08 - 上下文引擎与记忆系统

## 上下文引擎（Context Engine）

### 概述

上下文引擎控制 OpenClaw 如何为每次 LLM 调用组装模型上下文。它决定：
- 哪些消息被包含
- 如何处理历史消息
- 何时以及如何压缩
- 子 Agent 的上下文边界

### 四阶段生命周期

```
                    ┌────────────┐
    新消息到达 ────→│  1.Ingest   │  存储/索引消息
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
    LLM 调用前 ────→│ 2.Assemble  │  组装上下文（消息 + 系统提示）
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
    上下文满时 ────→│ 3.Compact   │  压缩/摘要旧历史
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
    回合结束后 ────→│4.AfterTurn  │  持久化状态/触发后处理
                    └────────────┘
```

### Legacy Engine（默认）

Legacy Engine 是 OpenClaw 的内置默认引擎：

```
Ingest:    无操作（Session Manager 直接处理持久化）
Assemble:  直通（现有的 sanitize → validate → limit 管道处理）
Compact:   内置摘要压缩
           ├── 旧消息 → 调用 LLM 生成摘要
           ├── 保留最近 N 条消息
           └── 摘要替换旧消息
AfterTurn: 无操作
```

### 自定义 Engine 示例

```typescript
// 一个使用向量检索的自定义引擎
api.registerContextEngine("vector-rag", () => ({
  info: {
    id: "vector-rag",
    name: "Vector RAG Engine",
    ownsCompaction: true,      // 接管压缩
  },

  async ingest({ sessionId, message }) {
    // 将消息存入向量数据库
    await vectorDB.store(sessionId, message);
    return { ingested: true };
  },

  async assemble({ sessionId, messages, tokenBudget }) {
    // 基于最后一条用户消息做向量检索
    const lastUserMsg = messages.findLast(m => m.role === "user");
    const relevantHistory = await vectorDB.search(
      sessionId,
      lastUserMsg.content,
      { maxTokens: tokenBudget * 0.3 }
    );

    // 组合：系统提示 + 检索的历史 + 最近消息
    const assembled = [
      ...relevantHistory,
      ...messages.slice(-10)  // 最近 10 条
    ];

    return {
      messages: assembled,
      estimatedTokens: countTokens(assembled),
      systemPromptAddition: "Retrieved relevant context from history.",
    };
  },

  async compact({ sessionId, force }) {
    // 向量引擎不需要传统压缩
    // 只需要清理过旧的索引
    await vectorDB.pruneOldEntries(sessionId, { olderThan: "30d" });
    return { ok: true, compacted: true };
  },

  async afterTurn({ sessionId, messages }) {
    // 批量索引本轮所有消息
    await vectorDB.batchIndex(sessionId, messages);
  },
}));
```

### ownsCompaction 的含义

```
ownsCompaction: true
├── Pi 内置的自动压缩被禁用
├── 引擎的 compact() 负责 /compact 命令
├── 引擎的 compact() 负责溢出恢复
└── 引擎自己决定何时和如何压缩

ownsCompaction: false
├── Pi 内置的自动压缩可能仍然运行
├── 引擎的 compact() 仍然处理 /compact 和溢出恢复
├── 可以调用 delegateCompactionToRuntime() 委托给内置实现
└── 注意：空的 compact() 是不安全的（会禁用压缩路径）
```

### Slot 排他性

上下文引擎是排他性 slot——同一时间只能有一个活跃：

```json5
{
  plugins: {
    slots: {
      contextEngine: "legacy"      // 默认
      // 或: "lossless-claw"       // 自定义引擎
      // 或: "vector-rag"          // 另一个自定义引擎
    }
  }
}
```

## 上下文组装详解

### 系统提示组装

```
系统提示 (System Prompt) 组成:

1. 核心系统指令（OpenClaw 自动生成）
   ├── Agent 身份信息
   ├── 可用工具说明
   ├── 通道信息（当前对话来源）
   └── 安全规则

2. Workspace 文件注入
   ├── AGENTS.md   → 操作指令 + 记忆（整个文件内容）
   ├── SOUL.md     → 人格、边界、语气
   ├── USER.md     → 用户信息、偏好
   ├── TOOLS.md    → 工具使用注释
   ├── IDENTITY.md → Agent 名称、emoji
   └── BOOTSTRAP.md → 首次运行仪式（只在首次注入，完成后删除）

3. Context Engine Addition（可选）
   └── 自定义引擎返回的 systemPromptAddition

4. 记忆文件（仅在主会话）
   ├── MEMORY.md → 长期记忆
   └── memory/YYYY-MM-DD.md → 今天+昨天的日志

文件截断规则:
├── 空文件被跳过
├── 大文件被截断，末尾添加标记
└── 缺失文件注入一行"missing file"标记
```

### 上下文窗口管理

```
Token Budget 分配:

┌─────────────────────────────────┐
│         Context Window           │
│        (e.g., 200K tokens)       │
│                                  │
│  ┌────────────────────────────┐ │
│  │    System Prompt           │ │  ~5-10K tokens
│  │  (instructions + files)    │ │
│  ├────────────────────────────┤ │
│  │    Session History         │ │  动态分配
│  │  (messages + tool results) │ │  （修剪旧工具结果）
│  ├────────────────────────────┤ │
│  │    Tool Definitions        │ │  ~2-5K tokens
│  ├────────────────────────────┤ │
│  │    Reserve Floor           │ │  20K tokens（默认）
│  │  (留给回复 + 工具调用)     │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘

当 Session History 接近限制时:
1. 先修剪旧的工具结果（pruning）
2. 触发记忆刷新（memoryFlush）
3. 执行压缩（compaction）
```

## 记忆系统（Memory）

### 设计理念

OpenClaw 的记忆是 **纯 Markdown 文件**——简单、透明、用户可编辑：

```
记忆 = 磁盘上的文件
模型的"记忆" = 文件被注入到上下文中

没有隐藏的数据库
没有不可见的状态
用户随时可以手动编辑记忆文件
```

### 记忆文件布局

```
<workspace>/
├── MEMORY.md                 # 长期记忆（策划的、重要的）
├── memory/
│   ├── 2026-03-21.md         # 今天的日志（追加模式）
│   ├── 2026-03-20.md         # 昨天的日志
│   ├── 2026-03-19.md         # 更早的日志
│   └── ...
└── ...
```

### 加载规则

```
MEMORY.md:
├── 仅在主会话（私人对话）中加载
├── 不在群组会话中加载（防止信息泄露）
├── MEMORY.md 和 memory.md 都存在时，只加载 MEMORY.md
└── memory.md 是 MEMORY.md 不存在时的回退

Daily Log:
├── 加载今天 + 昨天的日志
├── 追加模式（每次写入新内容）
└── Agent 自动记录
```

### 记忆工具

```
memory_search(query):
  ├── 输入: 自然语言查询
  ├── 过程:
  │   ├── 文本嵌入（Embedding）
  │   ├── 向量相似度搜索
  │   ├── BM25 关键词搜索（混合搜索模式）
  │   ├── MMR 多样性重排序（可选）
  │   └── 时间衰减（可选）
  └── 输出: 相关记忆片段列表

memory_get(path, lineRange):
  ├── 输入: 文件路径 + 可选行范围
  ├── 过程: 直接读取文件
  └── 输出: 文件内容（文件不存在返回空文本）
```

### 向量搜索配置

```json5
{
  memory: {
    // 嵌入提供者
    embedding: {
      provider: "openai",           // openai/gemini/voyage/mistral/ollama/gguf
      model: "text-embedding-3-small",
    },

    // 搜索配置
    search: {
      mode: "hybrid",              // "vector" | "bm25" | "hybrid"
      topK: 10,
      rerankDiversity: true,       // MMR 多样性
      temporalDecay: {
        enabled: true,
        halfLife: "30d",
      },
    },

    // QMD 后端（高级）
    qmd: {
      enabled: false,
      // 独立的 QMD sidecar 服务
    },

    // 多模态记忆
    multimodal: {
      enabled: false,
      // 支持图片记忆
    },
  }
}
```

### 记忆插件

```
memory-core（默认）:
├── Markdown 文件管理
├── 基础搜索（文本匹配）
└── 轻量级，无外部依赖

memory-lancedb:
├── LanceDB 向量数据库
├── 高性能向量搜索
├── 混合搜索（BM25 + Vector）
├── 自动索引更新
└── 需要安装 LanceDB 依赖
```

## 预压缩记忆刷新

这是一个精巧的设计——在压缩前提醒模型保存重要信息：

```
上下文接近满时:

1. 检测: token估计 > contextWindow - reserveFloor - softThreshold
   └── 默认: 200K - 20K - 4K = 176K tokens 时触发

2. 触发静默 Agent 回合:
   System Prompt 追加:
     "Session nearing compaction. Store durable memories now."
   User Prompt:
     "Write any lasting notes to memory/YYYY-MM-DD.md;
      reply with NO_REPLY if nothing to store."

3. Agent 执行:
   ├── 回顾当前上下文中的重要信息
   ├── 写入 memory/ 文件（使用 write 工具）
   └── 回复 NO_REPLY（静默，用户看不到）

4. 完成后正常压缩
   └── 旧消息被摘要替换，但重要信息已持久化到文件

5. 每个压缩周期只触发一次
   └── 通过 sessions.json 中的标记跟踪
```

### 配置

```json5
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,     // 保留 token 底线
        memoryFlush: {
          enabled: true,                // 默认开启
          softThresholdTokens: 4000,    // 触发阈值
          systemPrompt: "Session nearing compaction...",
          prompt: "Write durable notes to memory/..."
        }
      }
    }
  }
}
```

### 工作空间可写性要求

```
记忆刷新只在工作空间可写时运行:

workspaceAccess: "rw"  → ✅ 正常执行
workspaceAccess: "ro"  → ❌ 跳过（只读工作空间）
workspaceAccess: "none" → ❌ 跳过（无工作空间访问）
```

## 记忆最佳实践

```
写入时机:
├── 用户明确说 "记住这个" → 立即写入
├── 重要的决策/偏好 → 写入 MEMORY.md
├── 日常上下文/临时信息 → 写入 memory/YYYY-MM-DD.md
└── Agent 自主判断重要信息 → 预压缩刷新时写入

组织方式:
├── MEMORY.md: 按主题组织的策划内容
│   ├── ## 用户偏好
│   ├── ## 重要决策
│   ├── ## 常用联系人
│   └── ## 项目信息
│
└── memory/*.md: 时间线日志
    └── 每天一个文件，追加模式

注意事项:
├── Agent 只能 "记住" 被写入文件的信息
├── 单纯 "说过" 但没写入文件的内容会在压缩后丢失
├── 用户可以手动编辑这些文件
└── 文件就是数据库，所见即所得
```
