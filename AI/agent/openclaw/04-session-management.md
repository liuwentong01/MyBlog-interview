# 04 - 会话管理系统

## 概述

OpenClaw 的会话管理是连接消息通道和 Agent 运行时的关键纽带。它决定：
- 一条消息属于哪个"对话"（Session Key 解析）
- 对话历史如何存储和检索（JSONL 转录）
- 对话何时过期和重置（Reset Policy）
- 多用户之间如何隔离（dmScope 安全）
- 上下文如何优化（修剪、压缩、记忆刷新）

**核心设计决策**：所有会话状态由 Gateway 持有，UI 客户端必须查询 Gateway 获取（不能直接读取本地文件）。

## 会话键（Session Key）

### 键结构与 dmScope 映射

每条消息都被映射到一个唯一的会话键。DM 消息的键格式取决于 `session.dmScope` 配置：

```
dmScope="main"（默认，所有 DM 共享一个主会话）:
  agent:<agentId>:<mainKey>
  示例: agent:main:main

  特点: 多个手机号和通道可以映射到同一个 agent main key
        它们作为同一个对话的不同传输通道

dmScope="per-peer"（按发送者隔离）:
  agent:<agentId>:direct:<peerId>
  示例: agent:main:direct:+8613800138000

dmScope="per-channel-peer"（推荐多用户设置，按通道+发送者隔离）:
  agent:<agentId>:<channel>:direct:<peerId>
  示例: agent:main:telegram:direct:tg:123456789

dmScope="per-account-channel-peer"（多账号收件箱，按账号+通道+发送者隔离）:
  agent:<agentId>:<channel>:<accountId>:direct:<peerId>
  示例: agent:main:whatsapp:biz:direct:+8613800138000
  注意: accountId 默认为 "default"
```

### 群组/频道/特殊键

```
群组消息:
  agent:<agentId>:<channel>:group:<groupId>
  示例: agent:main:whatsapp:group:120363999@g.us

频道/房间消息:
  agent:<agentId>:<channel>:channel:<channelId>
  示例: agent:main:discord:channel:123456789012345678

Telegram 论坛话题（话题级隔离）:
  agent:<agentId>:telegram:group:<groupId>:topic:<threadId>

Cron 任务:
  cron:<jobId>                    # 隔离的（每次运行 mint 新 sessionId）
  session:<customId>              # 持久的（跨运行复用）

Webhook:
  hook:<uuid>                     # 除非 hook 配置显式指定

Node 运行:
  node-<nodeId>
```

### dmScope 的安全意义

这是一个**关键的安全设计**，直接影响用户隐私：

```
⚠️  安全警告: 如果你的 Agent 可以接收来自多个人的 DM，强烈建议启用安全 DM 模式。

问题场景（默认 dmScope="main"）:
1. Alice 发消息给你的 Agent 谈论私密话题（如医疗预约）
2. Bob 发消息问 "我们刚才在聊什么？"
3. 因为两人的 DM 共享同一个 session，模型可能用 Alice 的上下文回答 Bob
   → 私密信息泄露！

解决方案:
{
  session: {
    dmScope: "per-channel-peer"    // 推荐
  }
}

应启用安全 DM 模式的场景:
├── 配对审批了多个发送者
├── DM 白名单有多个条目
├── 设置了 dmPolicy: "open"
└── 多个手机号或账号可以给 Agent 发消息

注意:
├── 本地 CLI onboarding 默认写入 "per-channel-peer"（未设置时）
├── 已有显式值不会被覆盖
└── 可以用 openclaw security audit 验证 DM 设置
```

### Identity Links（身份关联）

当同一个人通过不同通道联系时，可以合并他们的会话：

```json5
{
  session: {
    identityLinks: {
      // provider-prefixed peer id → canonical identity
      "alice": ["telegram:123456789", "discord:987654321012345678"],
      "bob": ["whatsapp:+8613800138000", "signal:+8613800138000"]
    }
  }
}
// 效果: Alice 通过 Telegram 和 Discord 的 DM 会共享同一个 session
// 适用于 per-peer、per-channel-peer、per-account-channel-peer
```

## 会话存储

### 文件布局

```
~/.openclaw/agents/<agentId>/sessions/
├── sessions.json                    # 会话映射表（source of truth）
│                                     # 格式: sessionKey → { sessionId, updatedAt, ... }
│                                     # 删除条目是安全的，下次消息时重建
├── <SessionId>.jsonl                # 会话转录（一行一条消息）
├── <SessionId>-topic-<threadId>.jsonl  # Telegram 话题转录
├── <SessionId>.deleted.<timestamp>  # 已删除的归档
└── <SessionId>.reset.<timestamp>    # 已重置的归档
```

### sessions.json 结构

```json
{
  "agent:main:main": {
    "sessionId": "boot-2026-03-21_10-30-00-abc12345",
    "updatedAt": "2026-03-21T10:30:00Z",
    "inputTokens": 15000,
    "outputTokens": 5000,
    "totalTokens": 20000,
    "contextTokens": 18000,
    "origin": {
      "label": "WhatsApp DM",
      "provider": "whatsapp",
      "from": "+8613800138000",
      "to": "+8613900139000"
    },
    "displayName": "Alice",
    "channel": "whatsapp"
  },
  "agent:main:telegram:group:123456": {
    "sessionId": "group-tg-123456-xyz",
    "displayName": "开发组",
    "channel": "telegram",
    "subject": "Project Discussion",
    "room": "telegram:123456"
  }
}
```

### JSONL 转录格式

每行一个 JSON 对象，记录完整的对话历史：

```jsonl
{"role":"system","content":"You are...","timestamp":"..."}
{"role":"user","content":"Hello","timestamp":"...","meta":{"channel":"whatsapp","from":"+86..."}}
{"role":"assistant","content":"Hi!","timestamp":"...","usage":{"input":100,"output":50}}
{"role":"assistant","content":"","tool_calls":[{"id":"tc1","function":{"name":"exec","arguments":"{...}"}}]}
{"role":"tool","tool_call_id":"tc1","content":"Command output..."}
{"role":"assistant","content":"Done!","timestamp":"..."}
```

## 会话生命周期

### 重置策略

```
┌─────────────────────────────────────────────────────────────┐
│               会话重置决策树                                  │
│                                                              │
│  1. 收到新消息                                               │
│  2. 检查 resetByChannel（通道级覆盖，最高优先级）           │
│  3. 检查 resetByType（类型级覆盖: direct/group/thread）     │
│  4. 检查 reset（全局策略）                                   │
│                                                              │
│  策略类型:                                                   │
│  ├── daily: 每天凌晨 N 点重置                                │
│  │   └── 默认 4:00 AM Gateway 主机本地时间                   │
│  │   └── session 最后更新早于最近的 daily reset 时间 → 过期  │
│  ├── idle: 空闲 N 分钟后重置                                 │
│  │   └── 滑动空闲窗口                                        │
│  └── daily + idle: 先到先重置（哪个先过期就触发）           │
│                                                              │
│  类型映射:                                                   │
│  ├── direct = DM 对话                                        │
│  ├── group  = 群组对话                                       │
│  └── thread = Slack/Discord 线程、Telegram topics、          │
│              Matrix threads                                   │
│                                                              │
│  5. 如果会话过期 → 创建新 sessionId                          │
│  6. 如果未过期 → 继续使用当前会话                            │
│                                                              │
│  特殊: Cron jobs 每次运行始终 mint 新 sessionId（无复用）   │
└─────────────────────────────────────────────────────────────┘
```

### 配置示例

```json5
{
  session: {
    // 全局策略
    reset: {
      mode: "daily",
      atHour: 4,              // 凌晨 4 点
      idleMinutes: 120        // 或空闲 2 小时（先到先触发）
    },
    // 按会话类型覆盖
    resetByType: {
      direct: { mode: "idle", idleMinutes: 240 },
      group:  { mode: "idle", idleMinutes: 120 },
      thread: { mode: "daily", atHour: 4 }
    },
    // 按通道覆盖（优先级最高）
    resetByChannel: {
      discord: { mode: "idle", idleMinutes: 10080 }  // Discord 7 天
    },
    // 手动重置命令
    resetTriggers: ["/new", "/reset"]
  }
}
```

### 手动重置

```
/new              → 开始新会话，运行短"hello"问候 turn 确认重置
/new opus         → 新会话 + 切换模型（支持 alias、provider/model、provider 名模糊匹配）
/reset            → 重置当前会话
/new 和 /reset 发送的消息余下部分会被透传
```

## 会话修剪（Session Pruning）

### 概述

修剪在**每次 LLM 调用前**修剪旧工具结果，减少上下文膨胀。**不修改磁盘上的 JSONL 历史**。

### cache-ttl 模式（Anthropic 优化）

```
触发条件: 上次 Anthropic 调用距今超过 ttl（默认 5m）
效果: 减少 TTL 过期后首次请求的 cacheWrite 大小
      修剪后 TTL 窗口重置，后续请求可复用新缓存

智能默认（Anthropic）:
├── OAuth/setup-token profiles: 启用 cache-ttl + heartbeat=1h
├── API key profiles: 启用 cache-ttl + heartbeat=30m + cacheRetention="short"
└── 显式设置不会被覆盖
```

### 修剪规则

```
可修剪内容:
├── 仅 toolResult 消息
├── user + assistant 消息永不修改
├── 最后 keepLastAssistants (默认 3) 个 assistant 消息后的工具结果不修剪
├── 包含 image blocks 的工具结果被跳过
└── assistant 消息不足以建立 cutoff 时，跳过修剪

两级修剪:
├── Soft-trim（超大工具结果）:
│   ├── 保留 head + tail，中间插入 "..."
│   ├── 追加原始大小说明
│   └── 默认: maxChars=4000, headChars=1500, tailChars=1500
│
└── Hard-clear（更旧的工具结果）:
    ├── 整个结果替换为 placeholder
    └── 默认: "[Old tool result content cleared]"
```

### 修剪前后对比

```
修剪前:
[system] 系统提示
[user] 消息 1
[assistant] 回复 1（含工具调用）
[tool] 工具结果 1（58000 字符）    ← soft-trim
[assistant] 回复 2（含工具调用）
[tool] 工具结果 2（120000 字符）   ← hard-clear
[user] 消息 3
[assistant] 回复 3（含工具调用）    ← 在 keepLastAssistants 范围内
[tool] 工具结果 3                  ← 保留
[user] 当前消息

修剪后:
[system] 系统提示
[user] 消息 1
[assistant] 回复 1
[tool] "head...tail\n[Trimmed from 58000 chars]"
[assistant] 回复 2
[tool] "[Old tool result content cleared]"
[user] 消息 3
[assistant] 回复 3
[tool] 工具结果 3                  ← 完整保留
[user] 当前消息
```

### 修剪配置

```json5
{
  agents: {
    defaults: {
      contextPruning: {
        mode: "cache-ttl",          // "off" / "cache-ttl"
        ttl: "5m",                  // TTL 窗口
        keepLastAssistants: 3,      // 保护最近 N 个 assistant
        softTrimRatio: 0.3,
        hardClearRatio: 0.5,
        minPrunableToolChars: 50000,
        softTrim: {
          maxChars: 4000,
          headChars: 1500,
          tailChars: 1500
        },
        hardClear: {
          enabled: true,
          placeholder: "[Old tool result content cleared]"
        },
        tools: {
          allow: ["exec", "read"],    // 限制修剪的工具（可选）
          deny: ["*image*"]           // 排除的工具
        }
      }
    }
  }
}
```

## 会话压缩（Compaction）

当上下文窗口接近满时，自动或手动压缩：

```
触发条件:
├── 自动: token 估计 > contextWindow - reserveTokensFloor
├── 手动: 用户发送 /compact [instructions]
└── 溢出恢复: 上下文超限时的紧急压缩

压缩流程:
1. 预压缩记忆刷新（memoryFlush，如果启用）
   ├── 追加系统提示: "Session nearing compaction. Store durable memories now."
   ├── 运行静默 Agent turn
   ├── Agent 回顾当前上下文中的重要信息
   ├── 写入 memory/ 文件
   └── 回复 NO_REPLY（静默，用户看不到）

2. Context Engine 执行 compact()
   ├── Legacy Engine: 内置摘要压缩
   │   ├── 旧消息 → 调用 LLM 生成摘要
   │   ├── 保留最近 N 条消息
   │   └── 摘要替换旧消息
   └── Plugin Engine: 自定义压缩策略
       └── 例如 DAG 摘要、向量检索等

3. 流式发射 compaction 事件
4. 可触发重试，重置内存缓冲区和工具摘要
5. 更新 sessions.json 标记已压缩

配置:
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,      // 保留 token 底线
        memoryFlush: {
          enabled: true,                 // 默认开启
          softThresholdTokens: 4000,     // 触发阈值
          systemPrompt: "Session nearing compaction...",
          prompt: "Write durable notes to memory/..."
        }
      }
    }
  }
}
```

## 会话维护（Maintenance）

OpenClaw 自动清理旧会话以控制磁盘使用：

### 维护操作顺序

```
enforce 模式下的清理顺序:
1. 修剪过期条目（pruneAfter，默认 30 天）
2. 限制总条目数（maxEntries，默认 500，最旧的优先）
3. 归档已删除条目的转录文件
4. 清理旧的 .deleted/.reset 归档（resetArchiveRetention）
5. 轮转 sessions.json（rotateBytes，默认 10MB）
6. 磁盘预算强制（maxDiskBytes，可选）
   └── 向 highWaterBytes（默认 maxDiskBytes 的 80%）清理
       先清理最旧的 artifacts，再清理最旧的 sessions
```

### 配置示例

```json5
// 保守的 enforce 策略
{
  session: {
    maintenance: {
      mode: "enforce",              // "warn" (默认，只报告) / "enforce"
      pruneAfter: "45d",
      maxEntries: 800,
      rotateBytes: "20mb",
      resetArchiveRetention: "14d"
    }
  }
}

// 大型部署 + 硬磁盘预算
{
  session: {
    maintenance: {
      mode: "enforce",
      pruneAfter: "14d",
      maxEntries: 2000,
      rotateBytes: "25mb",
      maxDiskBytes: "2gb",
      highWaterBytes: "1.6gb"
    }
  }
}
```

### 性能注意事项

```
增加维护成本的因素:
├── 非常高的 maxEntries 值
├── 长 pruneAfter 窗口（保留过时条目）
├── sessions/ 下大量转录/归档文件
└── 启用 maxDiskBytes 但没有合理的修剪/上限

建议:
├── 生产环境使用 mode: "enforce"
├── 同时设置时间和数量限制（pruneAfter + maxEntries）
├── highWaterBytes 明显低于 maxDiskBytes（默认 80%）
└── 配置变更后用 --dry-run 预览影响
```

### CLI 命令

```bash
# 预览清理
openclaw sessions cleanup --dry-run --json

# 执行清理
openclaw sessions cleanup --enforce

# 活跃 key 保护
openclaw sessions cleanup --enforce --active-key agent:main:main
```

## 发送策略（Send Policy）

可以阻止向特定会话类型发送消息：

```json5
{
  session: {
    sendPolicy: {
      rules: [
        // 禁止向 Discord 群组发送
        { action: "deny", match: { channel: "discord", chatType: "group" } },
        // 禁止向 Cron 会话发送
        { action: "deny", match: { keyPrefix: "cron:" } },
        // 匹配原始 session key（含 agent:<id>: 前缀）
        { action: "deny", match: { rawKeyPrefix: "agent:main:discord:" } },
      ],
      default: "allow"
    }
  }
}
```

运行时覆盖（Owner 专用）：
- `/send on` — 允许发送
- `/send off` — 禁止发送
- `/send inherit` — 清除覆盖，使用配置规则

## Gateway 是唯一数据源

```
✅ 正确: macOS App → WS 请求 → Gateway → 返回会话列表
❌ 错误: macOS App → 直接读取本地 sessions.json

原因:
├── 远程模式下，sessions.json 在远程 Gateway 主机上
├── Token 计数来自 Gateway 的 store（inputTokens, outputTokens,
│   totalTokens, contextTokens），不是客户端解析 JSONL
├── 保持单一数据源，避免数据不一致
└── UI 客户端不解析 JSONL 转录来"修正"计数
```
