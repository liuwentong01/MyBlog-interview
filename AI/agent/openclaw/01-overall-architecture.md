# 01 - 整体架构概览

## 架构设计理念

OpenClaw 的架构围绕几个核心理念展开：

### 1. Gateway 中心化控制平面

整个系统的核心是一个 **单进程 Gateway**（网关），它是所有消息流转的中枢：

- **唯一入口**：所有消息通道（WhatsApp、Telegram 等）都连接到这一个 Gateway
- **WebSocket + HTTP 双协议**：WS 用于实时双向通信，HTTP 用于 Webhook/REST/UI
- **单机单实例**：每台机器只运行一个 Gateway（例如 WhatsApp 只能有一个活跃的 Baileys 会话）
- **默认绑定本地**：`ws://127.0.0.1:18789`，安全优先
- **分阶段 HTTP 管道**：请求按优先级通过 10 个阶段直到被处理

### 2. 插件化一切（Plugin Everything）

OpenClaw 采用了激进的插件化策略，核心精简到最小，所有能力通过插件扩展：

```
核心（Core）           插件（Extensions）          数量
─────────              ──────────────────          ────
Gateway 框架            消息通道                    20+（Telegram、Discord、WhatsApp...）
Agent 运行时            LLM 提供者                  30+（OpenAI、Anthropic、Google...）
Session 管理            记忆系统                    2（memory-core、memory-lancedb）
路由引擎               上下文引擎                  可扩展
CLI 框架               工具扩展                    10+（browser、firecrawl、tavily...）
Plugin SDK             集成插件                    5+（diagnostics、device-pair...）
```

插件与核心之间有**严格的导入边界**：

```
✅ 允许: 插件 → openclaw/plugin-sdk（公共 API）
✅ 允许: 插件 → 自己的 dependencies
❌ 禁止: 插件 → 核心 src/**（绝对禁止）
❌ 禁止: 插件 → 其他插件（绝对禁止）
```

### 3. Agent 即独立隔离单元

每个 Agent 是一个完全隔离的"大脑"，拥有独立的工作空间、会话和记忆：

```
Agent "main"                    Agent "work"
├── workspace/                  ├── workspace/
│   ├── AGENTS.md               │   ├── AGENTS.md        ← 操作指令
│   ├── SOUL.md                 │   ├── SOUL.md          ← 人格定义
│   ├── USER.md                 │   ├── USER.md          ← 用户信息
│   ├── TOOLS.md                │   ├── TOOLS.md         ← 工具注释
│   ├── IDENTITY.md             │   ├── IDENTITY.md      ← 名称/emoji
│   ├── MEMORY.md               │   ├── MEMORY.md        ← 长期记忆
│   ├── memory/                 │   ├── memory/          ← 每日记忆
│   └── skills/                 │   └── skills/          ← 工作空间技能
├── agents/main/                ├── agents/work/
│   ├── agent/                  │   ├── agent/
│   │   └── auth-profiles.json  │   │   └── auth-profiles.json
│   └── sessions/               │   └── sessions/
│       ├── sessions.json       │       ├── sessions.json
│       └── *.jsonl             │       └── *.jsonl
```

### 4. 安全作为一等公民

作为连接真实消息平台的系统，安全设计贯穿始终：

```
多层安全模型:
1. 传输安全    — TLS 支持，非 loopback 的明文 ws:// 被阻止
2. 认证模式    — Token / Password / Device Pairing / Bootstrap Token / None
3. 设备身份    — Ed25519 密钥对，基于 nonce 的 challenge-response
4. 设备配对    — 首次连接审批流，绑定角色/作用域
5. DM 配对     — 未知发送者需要验证码配对
6. 速率限制    — per-IP 认证失败限速
7. Origin 检查 — 浏览器客户端必须通过 allowed origins 验证
8. RBAC        — operator/node 角色 + admin/read/write/approvals 作用域
9. 沙箱支持    — Agent 可在 Docker 容器中沙箱运行
10. 工具权限   — per-agent 的工具白名单/黑名单
11. 本地信任   — 本地连接可自动审批，远程连接需显式批准
```

## Monorepo 结构

```
openclaw/
├── src/                    # 核心源代码（TypeScript ESM）
│   ├── gateway/            # Gateway 服务器（267 个文件，最大模块）
│   │   ├── server.impl.ts  #   主实现（500+ 行导入！）
│   │   ├── server-methods.ts #  WS API 方法处理器
│   │   ├── boot.ts         #   启动时执行 BOOT.md
│   │   └── ...
│   ├── agents/             # Pi Agent 运行时
│   │   ├── agent-command.ts #  Agent 命令执行入口
│   │   ├── pi-embedded-runner/ # Pi 嵌入式运行器
│   │   └── ...
│   ├── sessions/           # 会话管理（session key、存储、重置）
│   ├── channels/           # 通道抽象层
│   ├── routing/            # 消息路由（bindings、matching）
│   ├── config/             # 配置系统（JSON5、热重载）
│   ├── plugins/            # 插件加载与生命周期
│   │   ├── loader.ts       #   主加载编排器
│   │   ├── discovery.ts    #   插件目录扫描
│   │   ├── registry.ts     #   注册表 + API 工厂
│   │   ├── hooks.ts        #   25 个生命周期钩子
│   │   └── slots.ts        #   排他性 Slot 系统
│   ├── plugin-sdk/         # 插件 SDK（对外公共 API）
│   ├── context-engine/     # 上下文引擎（4 阶段生命周期）
│   ├── browser/            # 浏览器控制工具（CDP）
│   ├── canvas-host/        # Canvas/A2UI 宿主
│   ├── node-host/          # 移动端 Node 宿主
│   ├── media/              # 媒体管道（图片/音频/视频）
│   ├── cron/               # 定时任务
│   ├── hooks/              # 内部钩子系统
│   ├── memory/             # 记忆系统
│   ├── tts/                # 文本转语音
│   ├── providers/          # LLM 提供者抽象
│   ├── acp/                # Agent Communication Protocol
│   ├── auto-reply/         # 自动回复管道
│   ├── security/           # 安全模块
│   ├── cli/                # CLI 框架
│   ├── commands/           # CLI 命令
│   └── ...                 # 更多子模块
├── extensions/             # 插件包（70+ 个）
│   ├── telegram/           # Telegram 通道（grammY）
│   ├── discord/            # Discord 通道（discord.js）
│   ├── whatsapp/           # WhatsApp 通道（Baileys）
│   ├── openai/             # OpenAI 模型
│   ├── anthropic/          # Anthropic 模型
│   ├── google/             # Google Gemini 模型
│   ├── memory-lancedb/     # LanceDB 向量记忆
│   └── ...
├── ui/                     # Control UI（Lit + Vite）
├── apps/                   # 客户端应用
│   ├── ios/                # iOS 应用（Swift + SwiftUI）
│   ├── android/            # Android 应用（Kotlin + Compose）
│   └── macos/              # → Swabble
├── Swabble/                # macOS 语音助手框架（Swift）
├── packages/               # 遗留/兼容包（clawdbot、moltbot）
├── docs/                   # 文档（Mintlify）
├── skills/                 # 内置 Skills
├── scripts/                # 构建和运维脚本
└── test/                   # 集成测试
```

## 关键技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript (ESM) | 编排系统，易于扩展和阅读 |
| 运行时 | Node.js 24+（推荐）/ 22+ | 生态成熟，Bun 也支持 |
| 包管理 | pnpm monorepo | workspace 多包管理，70+ 插件 |
| 构建 | tsdown (基于 esbuild) | 快速 TypeScript 构建 |
| 类型校验 | tsgo (Go 实现的 tsc) | 超快类型检查 |
| 插件加载 | Jiti | 运行时 TypeScript 加载（含 SDK 别名映射） |
| 格式化/Lint | Oxfmt + Oxlint | Rust 实现，极速 |
| 测试 | Vitest | 与 Vite 生态一致 |
| 前端 UI | Lit (Web Components) | 轻量，无框架依赖 |
| iOS/macOS | SwiftUI + Observation | 现代 Apple 生态 |
| Android | Kotlin + Jetpack Compose | 现代 Android 生态 |
| 协议 | WebSocket (JSON) | 实时双向通信 |
| Schema | TypeBox | JSON Schema + TypeScript 类型 + Swift 模型生成 |
| Agent 核心 | pi-agent-core | 嵌入式 Agent 运行时 |
| AI SDK | pi-ai | LLM 抽象层（Model/Api 类型） |

## 核心依赖链

```
openclaw（根包）
├── @mariozechner/pi-agent-core    — Agent 执行循环
├── @mariozechner/pi-ai            — LLM API 抽象（Model, Api, StreamFn）
├── @mariozechner/pi-coding-agent  — ModelRegistry 类型
├── @sinclair/typebox              — JSON Schema + TypeScript 类型
├── commander                      — CLI 框架
└── extensions/* (workspace:*)     — 70+ 插件

extensions/<plugin>
├── devDependencies: openclaw (workspace:*)
├── dependencies: 插件特有依赖
└── peerDependencies: openclaw（运行时解析）
```

## 生命周期总览

### Gateway 启动流程

```
openclaw gateway [--port 18789]
    │
    ├── 1. 加载配置 (~/.openclaw/openclaw.json，JSON5 格式)
    ├── 2. 迁移遗留配置
    ├── 3. 准备密钥运行时快照
    ├── 4. 启动插件运行时
    │   ├── 扫描 4 个来源: config → workspace → bundled → global
    │   ├── 检查 openclaw.plugin.json 清单
    │   ├── 检查启用状态 + 解析依赖
    │   ├── Jiti 动态导入 + 调用 register 函数
    │   └── 注册到 PluginRegistry（通道、Provider、记忆、工具...）
    ├── 5. 初始化通道管理器（连接 WhatsApp/Telegram/...）
    ├── 6. 启动 WebSocket 服务器
    ├── 7. 启动 HTTP 服务器（分阶段管道）
    │   ├── Hooks → Tools Invoke → Sessions → Slack Callback
    │   ├── OpenResponses → Chat Completions → Canvas → Plugin Routes
    │   └── Control UI → Health Probes
    ├── 8. 启动心跳、健康监控、Cron 调度
    ├── 9. 运行启动认证检查
    ├── 10. 运行 BOOT.md（如果存在，执行启动脚本）
    └── 11. Gateway 就绪，开始接受连接
```

### 消息处理流程

```
1. 通道插件收到消息 → 标准化为 InboundMessage
       │
2. DM 配对/白名单检查
   ├── pairing: 未知发送者 → 发送配对码 → 等待审批
   ├── allowlist: 检查白名单
   └── open: 直接处理
       │
3. 路由引擎 → 确定 agentId
   └── bindings 规则匹配（最具体优先）
       │
4. Session 解析 → 确定 sessionKey
   └── dmScope + channel + peer → agent:<agentId>:...
       │
5. Queue 管理（enqueue 到 per-session lane）
   ├── collect: 合并排队消息（默认）
   ├── steer: 注入当前运行
   ├── followup: 等待当前完成
   └── typing indicator 立即触发
       │
6. Agent 运行时执行:
   a. 注入上下文（workspace 文件 + 会话历史 + 工具定义）
   b. 调用 LLM（流式响应）
   c. 工具调用循环（直到生成纯文本回复）
   d. 流式输出（Block Streaming + Preview Streaming）
       │
7. 回复发送回通道
   ├── Markdown → 平台特定格式
   ├── 长消息分块（per-channel textChunkLimit）
   └── 媒体附件处理
```

### 关闭流程

```
1. 收到停止信号
2. 运行 gateway_stop 钩子
3. 停止所有通道连接
4. 关闭 WS 服务器
5. 持久化会话状态
6. 清理资源（插件 dispose）
```
