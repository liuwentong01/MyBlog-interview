# 02 - Gateway 控制平面详解

## 概述

Gateway 是 OpenClaw 的核心控制平面，一个长期运行的守护进程（daemon），负责：
- 管理所有消息通道连接
- 提供 WebSocket API 供客户端连接
- 托管 Control UI 和 Canvas Host HTTP 服务
- 调度 Agent 运行、Cron 任务、Webhook 处理
- 管理会话状态和设备配对

Gateway 是整个系统中**最大的模块**，`src/gateway/` 下有 267 个文件。

## 核心文件结构

```
src/gateway/
├── server.ts                # 入口，re-export startGatewayServer
├── server.impl.ts           # Gateway 服务器主实现（500+ 行导入！）
├── boot.ts                  # 启动时执行 BOOT.md
├── client.ts                # WS 客户端连接管理
├── call.ts                  # Agent RPC 调用
│
├── server-methods.ts        # 核心 WS API 方法处理器
├── server-methods-list.ts   # WS 方法和事件注册表
├── server-methods/          # 分拆的方法处理器
│   ├── exec-approval.js     # 执行审批
│   ├── nodes.helpers.ts     # 节点辅助
│   └── secrets.ts           # 密钥管理
│
├── server-ws-runtime.ts     # WS 运行时处理器挂载
├── server-channels.ts       # 通道管理器创建
├── server-chat.ts           # 聊天事件处理
├── server-cron.ts           # Cron 服务构建
├── server-plugins.ts        # 插件加载
├── server-startup.ts        # Sidecar 服务启动
├── server-runtime-state.ts  # 运行时状态管理
├── server-runtime-config.ts # 运行时配置解析
├── server-model-catalog.ts  # 模型目录加载
├── server-session-key.ts    # 会话键解析
├── server-discovery-runtime.ts # mDNS 服务发现
├── server-tailscale.ts      # Tailscale 暴露
├── server-lanes.ts          # 并发通道管理
├── server-maintenance.ts    # 维护定时器
│
├── auth.ts                  # 认证逻辑
├── auth-rate-limit.ts       # 认证限速
├── connection-auth.ts       # 连接认证
├── startup-auth.ts          # 启动时认证
│
├── config-reload.ts         # 配置热重载
├── channel-health-monitor.ts # 通道健康监控
├── channel-health-policy.ts  # 健康策略
│
├── node-registry.ts         # Node 设备注册表
├── exec-approval-manager.ts # 执行审批管理
├── model-pricing-cache.ts   # 模型定价缓存
│
├── session-*.ts             # 会话相关工具
├── sessions-*.ts            # 会话列表/补丁
│
├── server/                  # 服务器子模块
│   ├── health-state.ts      # 健康状态
│   ├── readiness.ts         # 就绪检查
│   ├── tls.ts               # TLS 运行时
│   ├── hooks.ts             # 钩子处理
│   └── close-reason.ts      # WS 关闭原因
│
├── events.ts                # Gateway 事件定义
├── ws-log.ts                # WS 日志
└── control-ui.ts            # Control UI 状态
```

## WebSocket 协议

### 连接生命周期

```
Client                          Gateway
  │                               │
  │── ws://127.0.0.1:18789 ──────│  1. 建立 WebSocket 连接
  │                               │
  │── req:connect ───────────────→│  2. 第一帧必须是 connect
  │   {type:"req", method:"connect",│     包含设备身份、auth token、
  │    params: {                   │     角色（operator/node）
  │      auth: {token: "..."},     │
  │      device: {...},            │
  │      role: "operator"|"node"   │
  │    }}                          │
  │                               │
  │←── res:connect ──────────────│  3. 返回握手结果
  │   {ok: true, payload: {       │     包含 presence + health 快照
  │     snapshot: {presence, health}│
  │   }}                          │
  │                               │
  │←── event:presence ───────────│  4. 开始推送事件
  │←── event:tick ───────────────│
  │←── event:agent (streaming) ──│
  │                               │
  │── req:agent ─────────────────→│  5. 请求 Agent 执行
  │←── res:agent {status:"accepted"}│  6. Agent 接受/拒绝
  │←── event:agent (streaming) ──│  7. 流式 Agent 事件
  │←── res:agent {status:"done"}──│  8. Agent 完成
```

### 帧格式

所有通信使用 JSON 文本帧：

```typescript
// 请求
{
  type: "req",
  id: string,           // 请求 ID
  method: string,       // 方法名
  params: object        // 参数
}

// 响应
{
  type: "res",
  id: string,           // 对应请求 ID
  ok: boolean,          // 是否成功
  payload?: object,     // 成功载荷
  error?: {code, message} // 错误信息
}

// 事件（服务器推送）
{
  type: "event",
  event: string,        // 事件名
  payload: object,      // 事件数据
  seq?: number,         // 序列号
  stateVersion?: number // 状态版本
}
```

### 核心方法

| 方法 | 描述 |
|------|------|
| `connect` | 握手（必须是第一帧） |
| `health` | 健康状态查询 |
| `status` | 系统状态 |
| `send` | 发送消息到通道 |
| `agent` | 触发 Agent 执行 |
| `sessions.list` | 列出会话 |
| `sessions.send` | 向指定会话发送 |
| `system-presence` | 系统存在状态 |
| `cron.*` | Cron 任务管理 |
| `channels.*` | 通道管理 |
| `plugins.*` | 插件管理 |
| `models.*` | 模型管理 |
| `config.*` | 配置管理 |

### 核心事件

| 事件 | 描述 |
|------|------|
| `agent` | Agent 流式输出（工具调用、文本块） |
| `chat` | 聊天消息事件 |
| `presence` | 在线状态变更 |
| `health` | 健康状态变更 |
| `heartbeat` | 心跳 |
| `cron` | Cron 任务执行 |
| `tick` | 周期性状态推送 |
| `shutdown` | 关闭通知 |

## 认证与配对

### 设备配对流程

```
1. 新设备连接 → 发送 connect，包含 device identity
2. Gateway 检查设备是否已配对
3. 如果未配对：
   a. 生成配对码
   b. 要求用户在已信任的客户端上批准
   c. openclaw pairing approve <channel> <code>
4. 配对成功 → 颁发 device token
5. 后续连接使用 device token
```

### 认证层次

```
┌─────────────────────────┐
│    Gateway Auth Token    │  全局级：gateway.auth.token
│  (所有连接都需要检查)     │
├─────────────────────────┤
│     Device Pairing       │  设备级：设备身份签名 + 配对状态
│  (challenge-response)    │
├─────────────────────────┤
│    Role-based Access     │  角色级：operator vs node
│  (不同的 capabilities)   │
├─────────────────────────┤
│     DM Policy            │  消息级：pairing/allowlist/open
│  (控制谁可以发 DM)       │
└─────────────────────────┘
```

### 本地信任

- **本地连接**（loopback 或 Gateway 主机的 tailnet 地址）可以自动审批
- **非本地连接**仍需显式批准
- 签名 payload v3 还绑定 `platform` + `deviceFamily`，防止元数据篡改

## Node 连接

Node 是指移动端/桌面端的伴侣设备（macOS/iOS/Android），与普通客户端的区别：

```typescript
// Node 连接参数
{
  role: "node",
  caps: ["camera", "screen", "location", "canvas"],
  commands: ["canvas.push", "camera.snap", "screen.record", "location.get"],
  permissions: {...}
}
```

Node 提供设备级能力（相机、屏幕录制、位置等），Agent 可以通过 Gateway 调用这些能力。

## 配置热重载

Gateway 支持**运行时配置热重载**，无需重启：

```
config-reload.ts:
1. 文件系统监听 openclaw.json 变更
2. 差异计算（ConfigFileSnapshot）
3. 分类变更类型：
   - 通道配置变更 → 重新初始化对应通道
   - 模型配置变更 → 刷新模型目录
   - 插件配置变更 → 重新加载插件
   - Agent 配置变更 → 更新路由绑定
4. 应用变更，广播 reload 事件
```

## 健康监控

```
channel-health-monitor.ts:
├── 定期检查每个通道连接状态
├── 检测断线、认证过期、速率限制
├── 生成健康报告
└── 通过 event:health 推送给所有客户端

server/health-state.ts:
├── 维护全局健康快照缓存
├── 每次变更递增 healthVersion
├── 客户端可通过版本号增量获取
└── 包含：通道状态、Agent 状态、队列深度
```

## 并发控制（Lanes）

Gateway 使用 "Lanes" 概念控制并发：

```typescript
// server-lanes.ts
applyGatewayLaneConcurrency({
  // 限制同时进行的 Agent 运行数
  agentConcurrency: config.agents?.defaults?.concurrency ?? 3,
  // 限制同时进行的工具调用数
  toolConcurrency: config.tools?.concurrency ?? 5,
})
```

这确保系统不会因为过多并行请求导致资源耗尽。

## HTTP 服务

Gateway 的 HTTP 服务器使用 **分阶段管道（Staged Pipeline）** 架构，每个请求按顺序经过各阶段直到被处理：

```
HTTP 请求管道（按优先级顺序）:

1. Hooks (/hooks/...)         — Webhook 端点（外部集成唤醒、Agent 分发）
2. Tools Invoke               — HTTP 工具调用
3. Sessions Kill/History      — 会话管理 REST API
4. Slack Callback             — Slack API 回调
5. OpenResponses (可选)       — POST /v1/responses（OpenAI 兼容）
6. Chat Completions (可选)    — POST /v1/chat/completions（OpenAI 兼容）
7. Canvas                     — Canvas 宿主代理（认证 + HTTP 转发）
8. Plugin Routes              — 插件注册的 HTTP 端点
9. Control UI                 — SPA 管理界面
10. Health Probes             — /health, /healthz, /ready, /readyz
```

WebSocket 升级绕过 HTTP 管道，由 `attachGatewayUpgradeHandler` 拦截，分发到 Canvas WS 服务器或主 Gateway WS 服务器。

| 路径 | 功能 |
|------|------|
| `/` | Control UI（Lit Web Components） |
| `/__openclaw__/canvas/` | Canvas 宿主（Agent 可编辑的 HTML/CSS/JS） |
| `/__openclaw__/a2ui/` | A2UI 宿主（Agent-to-UI 通信） |
| `/hooks/...` | Webhook 端点 |
| `/health` `/healthz` | 健康检查 |
| `/ready` `/readyz` | 就绪检查 |
| `/v1/responses` | OpenAI Responses API 兼容（可选） |
| `/v1/chat/completions` | OpenAI Chat API 兼容（可选） |

所有 HTTP 端点都通过 Gateway 的认证系统保护。

## 安全架构

Gateway 采用多层安全模型：

```
1. 传输安全    — TLS 支持，非 loopback 的明文 ws:// 被阻止
2. 认证模式    — Token / Password / Device Pairing / Bootstrap Token / None
3. 设备身份    — Ed25519 密钥对，基于 nonce 的 challenge-response
                签名验证容忍 2 分钟时间偏差
4. 设备配对    — 首次连接审批流，绑定角色/作用域
5. 速率限制    — per-IP 认证失败限速（浏览器源有独立限速器）
6. Origin 检查 — 浏览器客户端必须通过 allowed origins 验证
7. RBAC        — 角色级（operator/node）+ 作用域级（admin/read/write/approvals/pairing）
8. 控制平面限速 — 写方法限制 3次/60秒/客户端
9. 慢消费者保护 — bufferedAmount 过高的客户端被断开（close 1008）
10. 预认证限制  — 认证前的消息有更小的 payload 限制
11. 未授权洪泛  — 重复未授权请求触发连接关闭
```
