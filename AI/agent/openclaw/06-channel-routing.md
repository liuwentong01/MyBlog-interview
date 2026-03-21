# 06 - 消息通道与路由系统

## 概述

OpenClaw 的路由系统负责将来自不同消息平台的消息准确地分发到目标 Agent。这是一个多层次的决策过程，涉及通道管理、DM 策略、去重/防抖、绑定规则、队列模式和会话映射。

## 消息流程总览

```
Inbound message
  → 去重检查（短时缓存，防止通道重连重复投递）
  → 防抖合并（debounceMs，相同发送者的快速连续消息）
  → DM 策略检查（pairing / allowlist / open）
  → routing/bindings → 确定 agentId
  → session key 解析
  → queue（如果有活跃运行：collect / steer / followup）
  → agent run（streaming + tools）
  → outbound replies（通道限制 + 分块 + 格式化）
```

## 通道抽象层

### 标准化消息格式

每个通道插件将平台特定的消息格式转换为 OpenClaw 的内部标准格式：

```typescript
// 标准化的入站消息
interface InboundMessage {
  // 来源标识
  channel: ChannelId;        // "telegram" | "discord" | "whatsapp" | ...
  accountId?: string;        // 多账号场景下的账号 ID
  from: string;              // 发送者 ID（平台格式）
  to?: string;               // 接收者 ID

  // 消息内容
  text?: string;             // 文本内容
  media?: MediaAttachment[]; // 媒体附件

  // 群组/线程信息
  group?: {
    id: string;
    kind: "group" | "channel";
    subject?: string;
    threadId?: string;
  };

  // 上下文
  replyTo?: string;          // 回复的消息 ID
  mentions?: string[];       // @提及
  reactions?: Reaction[];    // 表情反应

  // 元数据
  messageId: string;
  timestamp: Date;
  senderName?: string;
}
```

### 消息体分离

OpenClaw 将消息体分为三层：

```
Body:        发给 Agent 的 prompt 文本（可能包含通道信封和历史包装）
CommandBody: 原始用户文本，用于指令/命令解析
RawBody:     CommandBody 的遗留别名

历史包装格式:
  [Chat messages since your last reply - for context]
    sender1: message1
    sender2: message2
  [Current message - respond to this]
    sender3: current message

非直接聊天（群组/频道）中，当前消息体会加上发送者标签前缀，
保持实时和排队/历史消息在 Agent prompt 中的一致性。
```

### 入站去重

```
通道重连后可能重复投递同一消息。
OpenClaw 维护短生命周期缓存:
  key = channel + accountId + peer + session + messageId
  → 重复投递不会触发新的 Agent 运行
```

### 入站防抖

```
同一发送者的快速连续消息可以合并为单次 Agent turn:

配置:
{
  messages: {
    inbound: {
      debounceMs: 2000,           // 全局默认
      byChannel: {
        whatsapp: 5000,           // WhatsApp 5 秒
        slack: 1500,
        discord: 1500
      }
    }
  }
}

注意:
├── 仅文本消息参与防抖
├── 媒体/附件消息立即刷新
├── 控制命令绕过防抖（保持独立）
└── 使用最新消息的 reply threading/ID
```

## DM 访问策略

### 策略类型

```
dmPolicy 策略:

1. "pairing"（默认）
   ┌──────────┐     ┌────────────┐     ┌──────────┐
   │ 未知发送者 │ ──→ │ 发送配对码  │ ──→ │ 用户审批  │ ──→ 加入白名单
   └──────────┘     └────────────┘     └──────────┘
   Bot 回复: "Hey! I don't know you yet. Your pairing code is: ABC-123"
   用户审批: openclaw pairing approve telegram ABC-123

2. "allowlist"
   ┌──────────┐     ┌──────────────┐
   │ 检查白名单 │ ──→ │ 在列表中？    │ ──→ 是: 处理 / 否: 忽略
   └──────────┘     └──────────────┘

3. "open"（需显式启用，⚠️ 安全风险）
   ┌──────────┐
   │ 所有 DM   │ ──→ 直接处理
   └──────────┘

重要: DM 访问控制是全局 per-channel-account 的，不是 per-agent
```

### 白名单配置

```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+8613800138000", "+8613900139000"]
    },
    telegram: {
      dmPolicy: "pairing"
      // pairing 模式下，已批准的用户自动存入本地白名单
    }
  }
}
```

## 多 Agent 路由

### Agent 隔离性

每个 Agent 是一个**完全隔离的隔离单元**：

```
Agent 拥有独立的:
├── Workspace（文件、AGENTS.md/SOUL.md/USER.md、Skills）
├── State Directory（agentDir: auth profiles、model registry、per-agent config）
│   └── ~/.openclaw/agents/<agentId>/agent/auth-profiles.json
├── Session Store（聊天历史 + 路由状态）
│   └── ~/.openclaw/agents/<agentId>/sessions/
└── Skills（workspace/skills/ + 共享 ~/.openclaw/skills/）

重要:
├── Auth profiles 是 per-agent 的（不自动共享）
├── 永远不要跨 Agent 复用 agentDir（会导致 auth/session 冲突）
├── Workspace 是默认 cwd，不是硬沙箱
│   └── 相对路径解析在 workspace 内，绝对路径可达主机其他位置
│   └── 需要沙箱请启用 sandboxing
└── 如果要共享凭据，复制 auth-profiles.json 到另一个 Agent 的 agentDir
```

### Bindings（绑定规则）

当 Gateway 运行多个 Agent 时，使用 bindings 决定消息分发。绑定是**确定性的**，**最具体优先**：

```json5
{
  agents: {
    list: [
      { id: "main", workspace: "~/.openclaw/workspace-main" },
      { id: "work", workspace: "~/.openclaw/workspace-work" },
      { id: "family", workspace: "~/.openclaw/workspace-family" }
    ]
  },
  bindings: [
    // Tier 1: Peer 精确匹配（最高优先级）
    { agentId: "family", match: {
      channel: "whatsapp",
      peer: { kind: "group", id: "120363999@g.us" }
    }},

    // Tier 6: Account 级别匹配
    { agentId: "work", match: {
      channel: "whatsapp", accountId: "biz"
    }},

    // Tier 7: Channel 通配符
    { agentId: "main", match: {
      channel: "whatsapp", accountId: "*"
    }}
  ]
}
```

### 路由优先级（8 级匹配）

```
优先级从高到低:

Tier 1: peer 精确匹配
  match: { channel, peer: { kind: "direct"|"group"|"channel", id: "..." } }
  → 精确到某个人或某个群

Tier 2: parentPeer 匹配（线程继承）
  match: { channel, parentPeer: "..." }
  → 线程继承父消息的 Agent

Tier 3: guildId + roles（Discord 角色路由）
  match: { channel: "discord", guildId: "...", roles: [...] }
  → 基于 Discord 角色分发

Tier 4: guildId（Discord 服务器级别）
  match: { channel: "discord", guildId: "..." }

Tier 5: teamId（Slack 团队级别）
  match: { channel: "slack", teamId: "..." }

Tier 6: accountId 精确匹配
  match: { channel, accountId: "specific-account" }
  → 省略 accountId 只匹配默认账号

Tier 7: accountId 通配符
  match: { channel, accountId: "*" }
  → 跨所有账号的通道级回退

Tier 8: 默认 Agent
  agents.list 中 default: true 的，或第一个，默认 "main"

同 tier 多个匹配: 配置顺序中第一个获胜
```

### AND 语义

一个 binding 设置多个 match 字段时，全部必须满足（AND 关系）：

```json5
// 必须同时满足: channel=whatsapp AND accountId=biz AND peer 匹配
{
  agentId: "work",
  match: {
    channel: "whatsapp",
    accountId: "biz",
    peer: { kind: "group", id: "120363999@g.us" }
  }
}
```

### Account 作用域细节

```
├── 省略 accountId 的 binding → 只匹配默认账号
├── accountId: "*" → 跨所有账号的通道级回退
├── 后续为同一 Agent 添加显式 accountId 的 binding 时
│   → OpenClaw 会升级现有 channel-only binding 为 account-scoped
│      而不是重复创建
```

### 一个 WhatsApp 号码路由多人

同一 WhatsApp 号码可以按 DM 发送者路由到不同 Agent：

```json5
{
  agents: {
    list: [
      { id: "alex", workspace: "~/.openclaw/workspace-alex" },
      { id: "mia", workspace: "~/.openclaw/workspace-mia" }
    ]
  },
  bindings: [
    {
      agentId: "alex",
      match: { channel: "whatsapp", peer: { kind: "direct", id: "+15551230001" } }
    },
    {
      agentId: "mia",
      match: { channel: "whatsapp", peer: { kind: "direct", id: "+15551230002" } }
    }
  ],
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551230001", "+15551230002"]
    }
  }
}
// 注意: 回复仍然来自同一个 WhatsApp 号码（没有 per-agent 发送者身份）
```

## 群组消息处理

### 激活模式

```
群组策略:

1. @提及激活（默认）
   ├── 只有 @bot 或匹配 mentionPatterns 时响应
   ├── mentionPatterns: ["@assistant", "@openclaw", "@bot"]
   └── 提及检测 + 回复标签

2. 自由激活
   ├── groupPolicy: "open"
   └── 响应所有消息（适合小型私有群组）

3. 白名单
   ├── groupPolicy: "allowlist"
   └── 只在指定群组中响应
```

### 群组历史上下文

```
历史缓冲区（pending-only）:
├── 包含：未触发运行的群组消息（如 mention-gated 的消息）
├── 排除：已在 session 转录中的消息
├── 配置：messages.groupChat.historyLimit（全局）
│   └── 通道覆盖: channels.slack.historyLimit 等
│   └── 设为 0 禁用
├── 指令剥离仅应用于当前消息部分（历史保持完整）
└── Joiner 格式:
    [Chat messages since your last reply - for context]
      sender1: message1
    [Current message - respond to this]
      sender2: current message
```

### 不同平台的群组机制

```
Telegram:
├── 普通群组 → group:<groupId>
├── 超级群组 → group:<groupId>
└── 论坛群组 → group:<groupId>:topic:<threadId>
    └── 每个话题隔离会话

Discord:
├── 服务器频道 → channel:<channelId>
├── 线程 → channel:<channelId> + threadId
├── per-guild 配置（频道白名单、角色路由）
└── guildId + roles 路由（Tier 3-4）

Slack:
├── 频道 → channel:<channelId>
├── 线程 → channel:<channelId> + threadId
├── per-team 配置（teamId 路由 Tier 5）
└── 原生流式 API（nativeStreaming）

WhatsApp:
├── 群组 → group:<jid>
└── 提及检测 + 回复标签

Matrix:
├── 房间 → room:<roomId>
├── 线程 → room:<roomId> + threadId
└── Space 层级支持
```

## 出站消息处理

### 消息格式化与分块

```
Agent 生成回复
    │
    ├── 1. 确定目标通道和会话
    │   └── 从入站消息的 session origin 获取
    │
    ├── 2. 检查发送策略（Send Policy）
    │   └── 是否允许发送到此会话类型
    │
    ├── 3. 消息格式化
    │   ├── Markdown → 平台特定格式
    │   ├── 长消息分块（per-channel 规则）:
    │   │   ├── WhatsApp: textChunkLimit = 4096 字符
    │   │   ├── Telegram: textChunkLimit = 4096 字符
    │   │   ├── Discord:  textChunkLimit = 2000 字符
    │   │   │   └── maxLinesPerMessage = 17（避免 UI 裁剪）
    │   │   └── 其他通道各有限制
    │   ├── chunkMode:
    │   │   ├── "length"（默认）: 按字符数分块
    │   │   └── "newline": 先在空白行（段落边界）分割，再按长度
    │   └── 媒体附件处理
    │
    ├── 4. 前缀和回复线程
    │   ├── responsePrefix（全局 → 通道 → 账号级联）
    │   └── replyToMode（回复线程配置）
    │
    ├── 5. Block Streaming（如果启用）
    │   └── 见 03-agent-runtime.md 中的详细说明
    │
    └── 6. 通过通道插件发送
        └── plugin.send({ to, text, media, ... })
```

## 多账号支持

同一通道可以运行多个账号：

```json5
{
  channels: {
    whatsapp: {
      defaultAccount: "personal",
      accounts: {
        personal: { /* authDir */ },
        biz: { /* authDir */ }
      }
    },
    telegram: {
      accounts: {
        default: { botToken: "123456:ABC..." },
        alerts: { botToken: "987654:XYZ..." }
      }
    },
    discord: {
      accounts: {
        default: { token: "BOT_TOKEN_1" },
        coding: { token: "BOT_TOKEN_2" }
      }
    }
  }
}
```

### 支持多账号的通道

WhatsApp, Telegram, Discord, Slack, Signal, iMessage, IRC, LINE, Google Chat,
Mattermost, Matrix, Nextcloud Talk, BlueBubbles, Zalo, Zalo Personal, Nostr, Feishu

## 完整消息流转示例

```
场景: Alice 通过 WhatsApp 向 "work" Agent 发消息

1. WhatsApp (Baileys) 收到消息
   from: "+8613800138000", text: "帮我写一个 Python 脚本"

2. 去重检查 → 新消息 ✅

3. 防抖检查 → debounceMs=5000 内无更多消息 → 刷新

4. WhatsApp 插件标准化 → InboundMessage {
     channel: "whatsapp", accountId: "biz",
     from: "+8613800138000", text: "帮我写一个 Python 脚本",
     group: null  // DM
   }

5. DM 策略检查
   dmPolicy: "allowlist", allowFrom 包含 "+8613800138000" ✅

6. 路由引擎匹配
   binding: { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } }
   → Tier 6 匹配 → 路由到 Agent "work"

7. 会话键解析
   dmScope: "per-channel-peer"
   → sessionKey: "agent:work:whatsapp:direct:+8613800138000"

8. Queue 检查
   该 session 无活跃运行 → 直接启动

9. Agent "work" 处理
   workspace: ~/.openclaw/workspace-work/
   model: anthropic/claude-opus-4-6
   → 执行 Agent 循环（上下文组装 → LLM → 工具 → 回复）

10. 回复通过 WhatsApp 插件发送
    to: "+8613800138000"
    text: "好的，以下是一个 Python 脚本..."
    → textChunkLimit=4096 内 → 单条消息发送
```
