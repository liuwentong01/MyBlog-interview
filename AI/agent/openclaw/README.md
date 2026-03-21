# OpenClaw 架构分析

> 基于 https://github.com/openclaw/openclaw 仓库的深度架构分析
> 分析时间：2026-03-21

## 项目概述

OpenClaw 是一个**个人 AI 助手平台**，核心理念是让用户在自己的设备上运行 AI 助手，通过已有的即时通讯渠道（WhatsApp、Telegram、Slack、Discord、Signal、iMessage 等 20+ 平台）进行交互。

**关键特征：**
- **本地优先（Local-first）**：Gateway 运行在用户本机，所有数据留在本地
- **多通道统一**：一个 Gateway 控制所有消息平台
- **多 Agent 路由**：支持多个独立 Agent，每个有自己的工作空间、会话和权限
- **插件化架构**：核心精简，70+ 插件扩展能力（通道、LLM、记忆、工具...）
- **跨平台**：macOS/iOS/Android 客户端 + CLI + Web UI

**技术栈：** TypeScript (ESM)，Node.js 24+，pnpm monorepo，Vitest 测试，Lit Web Components

## 文档索引

| 文件 | 内容 | 重点级别 |
|------|------|----------|
| [01-overall-architecture.md](./01-overall-architecture.md) | 整体架构概览与核心设计理念 | 入门必读 |
| [02-gateway.md](./02-gateway.md) | Gateway 控制平面（WS/HTTP 协议、认证、安全、健康监控） | 核心 |
| [03-agent-runtime.md](./03-agent-runtime.md) | Pi Agent 运行时（执行循环、队列、流式输出、Provider Failover） | 核心 |
| [04-session-management.md](./04-session-management.md) | 会话管理（Session Key、dmScope 安全、修剪、压缩、维护） | 核心 |
| [05-plugin-system.md](./05-plugin-system.md) | 插件系统（25 个钩子、4 种执行模式、Plugin SDK API） | 核心 |
| [06-channel-routing.md](./06-channel-routing.md) | 消息通道与路由（8 级匹配、多 Agent 绑定、防抖去重） | 重要 |
| [07-tools-and-capabilities.md](./07-tools-and-capabilities.md) | 工具与能力（Browser/CDP、Canvas/A2UI、Node、Cron、Skills） | 重要 |
| [08-context-and-memory.md](./08-context-and-memory.md) | 上下文引擎与记忆（4 阶段生命周期、向量检索、记忆刷新） | 核心 |
| [09-companion-apps.md](./09-companion-apps.md) | 客户端应用（macOS Swabble、iOS/Android Node、Control UI） | 参考 |
| [10-project-structure.md](./10-project-structure.md) | 工程实践（构建、测试、配置、CI/CD、设计模式） | 参考 |

## 架构总览图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Messaging Channels                          │
│  WhatsApp │ Telegram │ Slack │ Discord │ Signal │ iMessage │ ...   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 标准化为 InboundMessage
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Gateway (单进程控制平面)                            │
│               ws://127.0.0.1:18789 + HTTP                           │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Channel  │  │ Session  │  │ Routing  │  │  Cron /  │            │
│  │ Manager  │  │ Manager  │  │ Engine   │  │ Webhooks │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  Plugin  │  │   Auth   │  │  Node    │  │  Canvas  │            │
│  │ Runtime  │  │ & Pairing│  │ Registry │  │   Host   │            │
│  │(70+ ext) │  │(Ed25519) │  │(iOS/And) │  │ (A2UI)   │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│                                                                      │
│  HTTP Pipeline (10 stages):                                          │
│  Hooks → Tools → Sessions → Slack → OpenResponses →                  │
│  Chat Completions → Canvas → Plugin Routes → Control UI → Health     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
  │  Pi Agent    │   │  CLI / TUI   │   │  Companion Apps  │
  │  Runtime     │   │  (openclaw)  │   │  macOS / iOS /   │
  │              │   └──────────────┘   │  Android / WebUI │
  │ ┌──────────┐│                       └──────────────────┘
  │ │ Context  ││   Queue: collect / steer / followup
  │ │ Engine   ││   Streaming: block / preview / coalesce
  │ └──────────┘│   Failover: profile rotation → model fallback
  │ ┌──────────┐│
  │ │ Tools    ││
  │ │ (built-in││
  │ │ +plugins)││
  │ └──────────┘│
  │ ┌──────────┐│
  │ │ Provider ││
  │ │ (30+ LLM)││
  │ └──────────┘│
  └──────────────┘
```

## 核心数据流

```
1. 用户发送消息 (WhatsApp/Telegram/...)
       │
2. Channel Plugin 接收 → 标准化为 InboundMessage
       │
3. 去重（短时缓存）+ 防抖（debounceMs 合并快速连续消息）
       │
4. DM 策略检查（pairing / allowlist / open）
       │
5. 路由引擎确定目标 Agent（Bindings，8 级最具体优先匹配）
       │
6. Session Key 解析（dmScope + channel + peer → agent:<agentId>:...）
       │
7. Queue 管理（per-session lane 序列化，collect/steer/followup 模式）
       │
8. Pi Agent Runtime 处理:
   a. Context Engine 组装上下文
      ├── 系统提示（13 个部分 + Bootstrap 文件注入）
      ├── 会话历史（JSONL，经过 pruning）
      └── 工具定义
   b. Auth Profile 轮换 → 调用 LLM Provider（流式响应）
   c. 解析 LLM 响应 → 工具调用 → 执行 → 结果反馈 → 循环
   d. Block Streaming（EmbeddedBlockChunker + Coalescing）
       │
9. 回复通过 Channel Plugin 发送回原平台
   ├── Markdown → 平台特定格式
   ├── 长消息分块（per-channel textChunkLimit）
   └── 可选: 类人节奏（humanDelay）
```
