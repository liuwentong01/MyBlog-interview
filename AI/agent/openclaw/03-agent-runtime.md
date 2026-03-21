# 03 - Pi Agent 运行时

## 概述

OpenClaw 的 Agent 运行时基于 **Pi Agent Core**（`@mariozechner/pi-agent-core`），是一个嵌入式的 AI Agent 执行引擎。它负责：
- 接收用户消息并组装上下文
- 调用 LLM 提供者（流式响应）
- 解析和执行工具调用（循环直到生成最终回复）
- 管理子 Agent 生命周期
- 流式输出到消息通道（Block Streaming）

## 核心文件结构

```
src/agents/
├── agent-scope.ts               # Agent 作用域解析（workspace、agentId、沙箱路径）
├── agent-paths.ts               # Agent 文件路径解析（sessions、workspace、auth-profiles）
├── agent-command.ts             # Agent 命令执行入口（agentCommand）
│
├── pi-embedded-runner/          # Pi 嵌入式运行器
│   └── runs.ts                  # runEmbeddedPiAgent — 核心执行函数
│
├── subagent-registry.ts         # 子 Agent 注册表
├── acp-spawn.ts                 # ACP 子 Agent 创建
├── acp-spawn-parent-stream.ts   # 父-子流式通信
│
├── model-catalog.ts             # 模型目录（ModelCatalogEntry 类型）
├── provider-capabilities.ts     # 提供者能力声明（ProviderCapabilities 类型）
├── tools/
│   └── common.ts                # AnyAgentTool 类型定义
│
├── auth-profiles/               # 认证配置文件管理
│   └── types.ts                 # ApiKeyCredential / OAuthCredential 类型
├── api-key-rotation.ts          # API 密钥轮换（cooldown + round-robin）
│
├── skills/                      # Skills 系统
│   └── refresh.ts               # Skills 快照加载和刷新
│
├── apply-patch.ts               # apply_patch 工具实现
├── announce-idempotency.ts      # 幂等性通告
├── auth-health.ts               # 认证健康检查
└── anthropic-payload-log.ts     # 调试用 payload 日志
```

## Agent 执行循环（Agent Loop）详解

这是 OpenClaw 最核心的运行逻辑——一个 agentic loop 的完整生命周期：

### 入口点

```
1. Gateway RPC: `agent` 和 `agent.wait` 方法
2. CLI: `openclaw agent --message "..."`
```

### 完整执行流程

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent 执行循环 (Agent Loop)                │
│                                                               │
│  1. 接收请求                                                  │
│     ├→ `agent` RPC 验证参数                                   │
│     ├→ 解析 session (sessionKey / sessionId)                  │
│     ├→ 持久化会话元数据                                       │
│     └→ 立即返回 { runId, acceptedAt }                         │
│                                                               │
│  2. agentCommand 执行                                         │
│     ├→ 解析模型 + thinking/verbose 默认值                     │
│     ├→ 加载 Skills 快照                                       │
│     └→ 调用 runEmbeddedPiAgent (pi-agent-core 运行时)         │
│                                                               │
│  3. runEmbeddedPiAgent                                        │
│     ├→ 通过 per-session + global 队列序列化运行               │
│     ├→ 解析模型 + auth profile，构建 pi session               │
│     ├→ 订阅 pi 事件，流式转发 assistant/tool deltas           │
│     ├→ 强制超时 → 超时则中止运行                              │
│     └→ 返回 payloads + usage 元数据                           │
│                                                               │
│  4. subscribeEmbeddedPiSession (事件桥接)                     │
│     ├→ tool events    => stream: "tool"                       │
│     ├→ assistant deltas => stream: "assistant"                │
│     └→ lifecycle events => stream: "lifecycle"                │
│         └→ phase: "start" | "end" | "error"                  │
│                                                               │
│  5. agent.wait (可选等待)                                     │
│     ├→ 等待 lifecycle end/error                               │
│     └→ 返回 { status: ok|error|timeout, startedAt, endedAt } │
│                                                               │
│  6. 会话 + 工作空间准备                                       │
│     ├→ 解析并创建工作空间（沙箱运行可重定向到沙箱路径）       │
│     ├→ Skills 加载（或复用快照）注入到 env 和 prompt          │
│     ├→ Bootstrap/context 文件解析并注入系统提示               │
│     └→ 获取 Session 写锁，SessionManager 准备就绪            │
│                                                               │
│  7. 工具执行循环                                              │
│     ├→ LLM 返回文本块 → 流式输出                              │
│     ├→ LLM 返回工具调用 → 执行工具 → 结果反馈 → 再调用 LLM  │
│     ├→ 循环直到 LLM 生成纯文本回复（无工具调用）             │
│     └→ 工具结果经过大小和图片负载清理后记录/发射             │
│                                                               │
│  8. 回复整形 + 抑制                                           │
│     ├→ 组装最终 payload：assistant 文本 + 推理 + 工具摘要    │
│     ├→ "NO_REPLY" 作为静默 token 被过滤                      │
│     ├→ 消息工具重复被移除                                     │
│     └→ 无可渲染 payload + 工具出错 → 回退工具错误回复        │
│                                                               │
│  9. 压缩 + 重试                                              │
│     ├→ 自动压缩发射 compaction 流事件                         │
│     ├→ 可触发重试，重置内存缓冲区和工具摘要                  │
│     └→ Queue 检查：如有排队消息，回到步骤 1                   │
└──────────────────────────────────────────────────────────────┘
```

### 超时与提前结束

```
超时控制:
├── agent.wait 默认: 30s（仅等待，不停止 Agent）
│   └── timeoutMs 参数可覆盖
├── Agent 运行时: agents.defaults.timeoutSeconds 默认 600s
│   └── 在 runEmbeddedPiAgent 中通过 abort timer 强制执行
│
提前结束场景:
├── Agent 超时（abort）
├── AbortSignal（取消）
├── Gateway 断线或 RPC 超时
└── agent.wait 超时（仅等待超时，不停止 Agent）
```

## 系统提示组装（System Prompt Assembly）

OpenClaw 为每次 Agent 运行构建自定义系统提示，**不使用** pi-coding-agent 的默认提示。

### 提示结构

```
系统提示 (System Prompt) 各部分:

1. Tooling          — 当前工具列表 + 简短描述
2. Safety           — 安全护栏提醒（避免权力寻求行为或绕过监督）
3. Skills           — 可用技能列表（名称 + 描述 + 文件路径）
4. Self-Update      — 如何运行 config.apply 和 update.run
5. Workspace        — 工作目录路径
6. Documentation    — 本地 OpenClaw 文档路径
7. Workspace Files  — Bootstrap 文件注入标记
8. Sandbox          — 沙箱运行时信息（如果启用）
9. Current Date     — 用户时区（不含动态时钟，保持 prompt cache 稳定）
10. Reply Tags      — 可选的回复标签语法
11. Heartbeats      — 心跳提示和 ack 行为
12. Runtime         — 主机、OS、Node、模型、仓库根目录、thinking 级别
13. Reasoning       — 当前可见级别 + /reasoning 切换提示
```

### 提示模式（Prompt Modes）

```typescript
// 运行时设置，不是用户配置
promptMode:
  "full"    — 包含所有部分（默认）
  "minimal" — 子 Agent 使用，省略 Skills、Memory Recall、Self-Update、
              Model Aliases、User Identity、Reply Tags、Messaging、
              Silent Replies、Heartbeats
  "none"    — 仅返回基本身份行
```

### 工作空间 Bootstrap 文件注入

Bootstrap 文件被修剪后附加到 **Project Context** 区域：

```
注入文件（按顺序）:
├── AGENTS.md      — 操作指令 + 记忆
├── SOUL.md        — 人格、边界、语气
├── TOOLS.md       — 工具使用注释
├── IDENTITY.md    — Agent 名称、emoji
├── USER.md        — 用户信息、偏好
├── HEARTBEAT.md   — 心跳配置
├── BOOTSTRAP.md   — 首次运行仪式（仅新工作空间，完成后删除）
└── MEMORY.md      — 长期记忆（或 memory.md 作为小写回退）

截断规则:
├── 每文件最大: agents.defaults.bootstrapMaxChars (默认 20000)
├── 总注入上限: agents.defaults.bootstrapTotalMaxChars (默认 150000)
├── 空文件被跳过
├── 大文件被截断，末尾添加截断标记
├── 缺失文件注入一行 missing-file 标记
└── 截断警告: agents.defaults.bootstrapPromptTruncationWarning
    (off / once / always，默认 once)

子 Agent 只注入: AGENTS.md + TOOLS.md（其他被过滤以保持上下文精简）
```

### Skills 注入

当有可用 Skills 时，注入紧凑的技能列表：

```xml
<available_skills>
  <skill>
    <name>Morning Brief</name>
    <description>Generate a morning briefing</description>
    <location>/path/to/skills/morning-brief/SKILL.md</location>
  </skill>
</available_skills>
```

模型被指示使用 `read` 工具加载指定路径的 SKILL.md，保持基础提示精简。

### 内部钩子拦截

```
agent:bootstrap 钩子:
├── 在系统提示最终化前运行
├── 可以修改或替换注入的 bootstrap 文件
└── 示例: 为特定会话切换 SOUL.md 人格
```

## 队列系统（Command Queue）

OpenClaw 通过进程内队列序列化入站 auto-reply 运行，防止多个 Agent 运行冲突。

### 队列架构

```
Lane-aware FIFO Queue:
├── Per-session 队列: 保证每个 session 同时只有一个活跃运行
│   └── lane: "session:<key>"
├── Global 队列: 控制整体并行度
│   └── lane: "main"（默认）
│   └── agents.defaults.maxConcurrent 控制并行数
├── 附加 lanes:
│   ├── "cron"     — 后台 Cron 任务
│   └── "subagent" — 子 Agent 运行
└── 无外部依赖: 纯 TypeScript + Promises

默认并发:
├── main lane: 4（未配置时默认 1）
├── subagent lane: 8
└── 单 session: 1（严格序列化）
```

### 5 种队列模式详解

```
┌─────────────────────────────────────────────────────────────┐
│  steer 模式                                                  │
│                                                              │
│  正在执行的 Agent Run                                        │
│      │                                                       │
│      ├── 工具调用 1 ──→ 执行完成                             │
│      │                                                       │
│      │   ← 新消息到达（排入队列）                            │
│      │                                                       │
│      ├── 工具调用 2 ──→ 跳过！                               │
│      │   "Skipped due to queued user message."               │
│      ├── 工具调用 3 ──→ 跳过！                               │
│      │                                                       │
│      └── 注入排队消息 → 继续下一轮 Assistant 回复            │
│                                                              │
│  行为: 在每次工具调用边界后检查，取消剩余工具调用，          │
│        如果不在流式中则回退到 followup                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  followup 模式                                               │
│                                                              │
│  正在执行的 Agent Run → 完成                                 │
│      │                                                       │
│      └── 排队消息 → 新一轮 Agent Run                         │
│                                                              │
│  行为: 新消息等待当前 turn 完成，然后作为新 turn 输入        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  collect 模式（默认）                                        │
│                                                              │
│  正在执行的 Agent Run → 完成                                 │
│      │                                                       │
│      └── 所有排队消息合并为单条 → 新一轮 Agent Run           │
│                                                              │
│  行为: 类似 followup，但合并所有排队消息为单个 followup      │
│  注意: 如果消息目标不同的 channels/threads，则分别处理       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  steer-backlog 模式 (steer+backlog)                          │
│                                                              │
│  行为: steer 当前运行 + 保留消息用于 followup                │
│  注意: 可能产生两次响应（steered + followup），              │
│        流式界面可能看起来重复                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  interrupt 模式（遗留）                                      │
│                                                              │
│  行为: 中止该 session 的活跃运行，然后运行最新消息           │
└─────────────────────────────────────────────────────────────┘
```

### 队列配置

```json5
{
  messages: {
    queue: {
      mode: "collect",           // 全局默认模式
      debounceMs: 1000,          // 等待安静后再启动 followup turn
      cap: 20,                   // 每 session 最大排队数
      drop: "summarize",         // 溢出策略: old / new / summarize
      byChannel: {               // 每通道覆盖
        discord: "collect",
        telegram: "steer"
      }
    }
  }
}
// 运行时命令:
// /queue collect              — 设置当前 session 模式
// /queue collect debounce:2s cap:25 drop:summarize  — 组合选项
// /queue default | /queue reset — 清除 session 覆盖
```

**溢出策略 `summarize`**：保留被丢弃消息的简短要点列表，注入为合成 followup prompt。

## 模型提供者（Provider）

### 模型引用格式

```
格式: "provider/model"
示例:
  - "openai/gpt-5.4"
  - "anthropic/claude-opus-4-6"
  - "google/gemini-3.1-pro-preview"
  - "openrouter/moonshotai/kimi-k2"
```

### Provider 插件能力（完整列表）

```typescript
// 插件注册的 Provider 能力声明
interface ProviderRegistration {
  // 模型目录
  catalog: ModelCatalogEntry[];              // 静态模型目录
  resolveDynamicModel(id: string);           // 动态模型解析（任意 model ID 透传）
  prepareDynamicModel(id: string);           // 元数据刷新
  normalizeResolvedModel(model);             // URL 重写

  // 认证
  auth: [{
    label: string;
    kind: "oauth" | "api_key" | "token" | "device_code" | "custom";
    run(ctx: ProviderAuthContext): ProviderAuthResult;
    runNonInteractive(opts): ProviderAuthResult;
  }];
  refreshOAuth(credential: OAuthCredential); // OAuth 令牌刷新
  formatApiKey(key: string);                 // 格式化 API Key
  prepareRuntimeAuth(profile);               // 准备运行时 token

  // 请求定制
  capabilities: ProviderCapabilities;        // 提供者能力声明
  prepareExtraParams(model, params);         // 注入额外请求参数
  wrapStreamFn(fn, model);                   // 包装请求函数（添加 headers 等）

  // 高级功能
  isBinaryThinking();                        // 是否二元 thinking
  supportsXHighThinking();                   // 是否支持 xhigh thinking
  resolveDefaultThinkingLevel();             // 默认 thinking 级别
  isCacheTtlEligible();                      // prompt cache TTL
  fetchUsageSnapshot(): ProviderUsageSnapshot; // 用量查询

  // Onboarding
  wizard: {
    setup: [{ label, value }];               // 设置选项
    modelPicker: { models: [...] };          // 模型选择器
  };
}
```

### 认证配置管理

```
认证存储路径:
~/.openclaw/agents/<agentId>/agent/auth-profiles.json

凭据类型:
├── type: "api_key"  → { provider, key }
├── type: "oauth"    → { provider, access, refresh, expires, email? }
│                       (+ projectId / enterpriseUrl for some providers)
└── Profile ID:
    ├── 默认: "provider:default"（无 email 时）
    └── OAuth: "provider:<email>"（如 "google-antigravity:user@gmail.com"）
```

### Auth Profile 轮换策略

```
轮换顺序（优先级从高到低）:
1. 显式配置: auth.order[provider]（如果设置）
2. 配置的 profiles: auth.profiles 按 provider 过滤
3. 存储的 profiles: auth-profiles.json 中的条目

Round-Robin 排序:
├── 主键: profile 类型（OAuth 优先于 API Keys）
├── 次键: usageStats.lastUsed（最旧的优先，同类型内）
└── Cooldown/disabled profiles 移到末尾

Session 固定（缓存友好）:
├── 选定的 auth profile 在 session 内固定
├── 不会每次请求都轮换
├── 以下情况解除固定:
│   ├── session 重置（/new 或 /reset）
│   ├── compaction 完成
│   └── profile 进入 cooldown/disabled
├── /model ...@<profileId> 设置用户覆盖（锁定）
└── 自动固定作为偏好（rate limit 时可轮换）
```

### Cooldown 机制

```
触发: auth/rate-limit 错误，或看起来像 rate limiting 的超时

指数退避:
  1 分钟 → 5 分钟 → 25 分钟 → 1 小时（上限）

存储格式（auth-profiles.json）:
{
  "usageStats": {
    "provider:profile": {
      "lastUsed": 1736160000000,
      "cooldownUntil": 1736160600000,
      "errorCount": 2
    }
  }
}

计费禁用（billing failures）:
├── 默认退避: 5 小时起，倍增，上限 24 小时
├── 24 小时无失败则重置计数器
└── 存储: disabledUntil + disabledReason: "billing"
```

### 模型 Failover 流程

```
┌──────────────────────────────────────────────────────────┐
│               两阶段 Failover                             │
│                                                           │
│  阶段 1: Auth Profile 轮换（同一 Provider 内）           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│  │ Profile A │ →→ │ Profile B │ →→ │ Profile C │          │
│  │ (OAuth)   │    │ (API Key) │    │ (API Key) │          │
│  └──────────┘    └──────────┘    └──────────┘           │
│       ↓ 全部失败                                         │
│                                                           │
│  阶段 2: Model Fallback（跨 Provider）                   │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │ primary:          │ →→ │ fallback:        │            │
│  │ anthropic/claude  │    │ openai/gpt-5.4   │            │
│  └──────────────────┘    └──────────────────┘           │
│                                                           │
│  触发 failover 的错误类型:                                │
│  ├── auth failures（认证失败）                            │
│  ├── rate limits（速率限制）                              │
│  ├── timeouts（超时，已耗尽 profile 轮换）               │
│  ├── format/invalid-request errors                        │
│  └── OpenAI 兼容的 stop-reason: error                    │
│                                                           │
│  不触发 failover 的: 其他通用错误                         │
└──────────────────────────────────────────────────────────┘

配置:
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["openai/gpt-5.4", "google/gemini-3.1-pro"]
      }
    }
  }
}
```

## 流式输出（Block Streaming）

OpenClaw 有两个独立的流式层：

### 1. Block Streaming（通道消息）

将完成的**文本块**作为通道消息发送（不是 token 级别的 delta）：

```
Model output
  └─ text_delta/events
       ├─ (blockStreamingBreak=text_end)
       │    └─ chunker 在缓冲区增长时发射块
       └─ (blockStreamingBreak=message_end)
            └─ chunker 在 message_end 时刷新
                   └─ channel send（块回复）
```

### 2. Preview Streaming（Telegram/Discord/Slack）

更新临时**预览消息**，基于消息级别的发送+编辑：

```
模式:
├── off:      禁用预览流
├── partial:  单个预览，被最新文本替换
├── block:    分块/追加式预览更新
└── progress: 生成中显示进度/状态预览，完成时显示最终答案

通道支持:
| Channel  | off | partial | block | progress    |
|----------|-----|---------|-------|-------------|
| Telegram | ✅  | ✅      | ✅    | → partial   |
| Discord  | ✅  | ✅      | ✅    | → partial   |
| Slack    | ✅  | ✅      | ✅    | ✅          |
```

### 分块算法（EmbeddedBlockChunker）

```
EmbeddedBlockChunker 规则:
├── Low bound: 缓冲区 < minChars 时不发射（除非强制）
├── High bound: 在 maxChars 前优先分割
├── Break preference（优先级从高到低）:
│   1. paragraph（段落边界 \n\n）
│   2. newline（换行 \n）
│   3. sentence（句子边界）
│   4. whitespace（空白处）
│   5. hard break（强制截断）
├── 代码围栏: 永不在围栏内分割
│   └── 强制截断时: 关闭围栏 + 重新打开，保持 Markdown 合法
└── maxChars 被 channel textChunkLimit 钳制

通道文本限制:
├── WhatsApp: 4096 字符
├── Telegram: 4096 字符
├── Discord:  2000 字符
└── Discord maxLinesPerMessage: 17（避免 UI 裁剪）
```

### 合并（Coalescing）

```
Block Streaming 合并机制:
├── 等待 idle 间隙（idleMs）后再刷新
├── 缓冲区超过 maxChars 时强制刷新
├── minChars 防止微小片段发送
├── 最终刷新始终发送剩余文本
├── Joiner 由 breakPreference 决定:
│   ├── paragraph → "\n\n"
│   ├── newline → "\n"
│   └── sentence → " "
└── Signal/Slack/Discord 默认 minChars 提升到 1500
```

### 类人节奏（Human-like Pacing）

```json5
{
  agents: {
    defaults: {
      humanDelay: {
        mode: "natural",   // off / natural / custom
        // natural: 800-2500ms
        // custom: { minMs, maxMs }
      }
    }
  }
}
// 仅适用于块回复，不适用于最终回复或工具摘要
```

### 完整配置

```json5
{
  agents: {
    defaults: {
      blockStreamingDefault: "off",         // "on" / "off"
      blockStreamingBreak: "text_end",      // "text_end" / "message_end"
      blockStreamingChunk: {
        minChars: 800,
        maxChars: 1200,
        breakPreference: "paragraph"        // paragraph/newline/sentence
      },
      blockStreamingCoalesce: {
        minChars: 400,
        maxChars: 2000,
        idleMs: 500
      }
    }
  },
  channels: {
    telegram: {
      streaming: "partial",                 // off/partial/block/progress
      blockStreaming: true,                 // 通道级覆盖
      textChunkLimit: 4096
    },
    discord: {
      streaming: "partial",
      blockStreaming: false,
      maxLinesPerMessage: 17
    }
  }
}
```

## Thinking 模式

```
用户命令:
/think         → 开启 thinking（默认级别）
/think high    → 高 thinking budget
/think xhigh   → 超高 thinking budget（部分模型支持）
/think off     → 关闭 thinking
/fast          → 快速模式（低 latency，provider 特定实现）

Provider 映射:
├── Anthropic: extended_thinking 参数
├── OpenAI:    reasoning_effort 参数
└── 其他:      Provider 插件自定义映射（isBinaryThinking, supportsXHighThinking）
```

## 子 Agent 系统

### ACP (Agent Communication Protocol)

```
src/acp/
├── server.ts              # ACP 服务端
├── client.ts              # ACP 客户端
├── session.ts             # ACP 会话
├── translator.ts          # 消息翻译器
├── persistent-bindings.ts # 持久绑定
└── policy.ts              # ACP 策略
```

### 子 Agent 生命周期

```
主 Agent Run
    │
    ├── 工具调用: sessions_spawn({
    │     prompt: "...",
    │     model: "anthropic/claude-sonnet-4-6",  // 可选不同模型
    │     tools: { allow: ["read", "exec"] },    // 可选工具限制
    │     workspace: "..."                        // 可选独立工作空间
    │   })
    │   └── 创建子 Agent:
    │       ├── 独立会话
    │       ├── 独立工具权限
    │       ├── 可以是不同模型
    │       └── promptMode: "minimal"（精简系统提示）
    │
    ├── 子 Agent 执行...
    │   └── 流式结果通过 acp-spawn-parent-stream 回传父 Agent
    │
    └── 子 Agent 完成
        └── 结果合并到父 Agent 上下文

子 Agent 状态: RUNNING / COMPLETED / FAILED / SWEPT（被清理）
```

### 子 Agent 上下文控制

```
子 Agent 的精简措施:
├── promptMode: "minimal"
│   └── 省略: Skills、Memory、Self-Update、Reply Tags 等
├── Bootstrap 文件: 仅注入 AGENTS.md + TOOLS.md
├── 上下文标签: "Subagent Context"（而非 "Group Chat Context"）
└── 独立 session lane（subagent lane 并发上限 8）
```

## 内置工具

| 工具 | 描述 |
|------|------|
| `read` | 读取文件（支持行范围、图片、PDF） |
| `write` | 写入/覆盖文件 |
| `edit` | 编辑文件（基于 diff 的精确修改） |
| `exec` | 执行 shell 命令（受沙箱和策略控制） |
| `apply_patch` | 应用 unified diff 补丁（可选，tools.exec.applyPatch=true） |
| `message` | 发送消息到通道 |
| `notify` | 系统通知（通过 Node 设备推送） |
| `sessions_list` | 列出活跃会话 |
| `sessions_history` | 查看会话历史 |
| `sessions_send` | 向指定会话发送消息 |
| `sessions_spawn` | 创建子 Agent |
| `session_status` | 会话状态 + 当前时间戳 |
| `memory_search` | 语义记忆搜索（向量 + BM25 混合） |
| `memory_get` | 精确读取记忆文件 |
| `cron_*` | 定时任务管理 |
| `browser` | 浏览器控制（CDP） |
| `canvas.*` | Canvas 操作 |
| `camera.*` | 相机操作（通过 Node） |
| `screen.record` | 屏幕录制（通过 Node） |
| `location.get` | 获取位置（通过 Node） |

## 钩子拦截点

Agent 循环中可被拦截的点：

```
Plugin 钩子（Agent + Gateway 生命周期）:
├── before_model_resolve  — 模型解析前（无 messages），可覆盖 provider/model
├── before_prompt_build   — Session 加载后（有 messages），可注入:
│   ├── prependContext       — 每轮动态文本
│   ├── systemPrompt         — 系统提示
│   ├── prependSystemContext — 系统提示前置
│   └── appendSystemContext  — 系统提示追加
├── before_agent_start    — 遗留兼容钩子
├── before_tool_call      — 工具调用前（可修改参数）
├── after_tool_call       — 工具调用后
├── tool_result_persist   — 同步转换工具结果（写入转录前）
├── agent_end             — Agent 完成后（可检查最终消息列表）
├── before_compaction / after_compaction — 压缩周期
├── message_received / message_sending / message_sent — 消息钩子
└── session_start / session_end — 会话生命周期

Internal 钩子（Gateway hooks）:
├── agent:bootstrap — 构建 bootstrap 文件时运行
│   └── 可添加/移除 bootstrap 上下文文件
└── 命令钩子: /new、/reset、/stop 等事件
```
