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
├── server.impl.ts           # Gateway 服务器主实现（1355 行）
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
├── server-http.ts           # HTTP 分阶段管道（200+ 行导入）
├── server-runtime-state.ts  # 运行时状态创建（HTTP/WS/Canvas）
├── server-ws-runtime.ts     # WS 运行时处理器挂载
├── server-channels.ts       # 通道管理器创建
├── server-chat.ts           # 聊天事件处理
├── server-cron.ts           # Cron 服务构建
├── server-plugins.ts        # 插件加载
├── server-startup.ts        # Sidecar 服务启动
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
├── device-auth.ts           # 设备 Ed25519 签名
├── connection-auth.ts       # 连接认证
├── startup-auth.ts          # 启动时认证
│
├── config-reload.ts         # 配置热重载
├── config-reload-plan.ts    # 热重载规则映射
├── channel-health-monitor.ts # 通道健康监控
├── channel-health-policy.ts  # 健康策略
│
├── node-registry.ts         # Node 设备注册表
├── exec-approval-manager.ts # 执行审批管理
├── model-pricing-cache.ts   # 模型定价缓存
│
├── server/                  # 服务器子模块
│   ├── health-state.ts      # 健康状态
│   ├── readiness.ts         # 就绪检查
│   ├── tls.ts               # TLS 运行时
│   ├── hooks.ts             # 钩子处理
│   ├── plugins-http.ts      # 插件 HTTP 路由
│   └── close-reason.ts      # WS 关闭原因
│
├── events.ts                # Gateway 事件定义
├── ws-log.ts                # WS 日志
└── control-ui.ts            # Control UI 状态
```

## Gateway 启动序列（server.impl.ts）

整个 Gateway 由 `startGatewayServer` 函数编排，遵循严格的线性启动序列：

```typescript
// 真实类型定义
export type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};

export type GatewayServerOptions = {
  bind?: GatewayBindMode;     // loopback | lan | tailnet | auto
  host?: string;
  controlUiEnabled?: boolean;
  openAiChatCompletionsEnabled?: boolean;
  openResponsesEnabled?: boolean;
  auth?: GatewayAuthConfig;
  tailscale?: GatewayTailscaleConfig;
  allowCanvasHostInTests?: boolean;
  wizardRunner?: (...) => Promise<void>;
};

export async function startGatewayServer(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer>
```

### 10 阶段启动流程

```
┌──────────────────────────────────────────────────────────────┐
│  startGatewayServer() 启动序列（1355 行编排）                  │
│                                                               │
│  1. Config Loading & Migration                                │
│     ├→ readConfigFileSnapshot() 读取 openclaw.json            │
│     ├→ 自动迁移遗留配置条目                                    │
│     ├→ 验证配置 + 自动启用插件                                 │
│     └→ 产出: cfgAtStart (OpenClawConfig)                      │
│                                                               │
│  2. Secrets Activation                                        │
│     ├→ activateRuntimeSecrets() 带锁序列化                    │
│     ├→ 降级恢复（解密失败时继续启动）                          │
│     └→ 启动失败快速失败语义                                    │
│                                                               │
│  3. Auth Bootstrap                                            │
│     ├→ prepareGatewayStartupConfig() 解析认证模式             │
│     ├→ 缺失 token 时自动生成并持久化                          │
│     └→ 产出: resolvedAuth (ResolvedGatewayAuth)               │
│                                                               │
│  4. Plugin Loading                                            │
│     ├→ loadGatewayPlugins() 返回 pluginRegistry               │
│     ├→ 通道插件贡献额外 gatewayMethods                        │
│     └→ 产出: pluginRegistry + 合并的 gatewayMethods           │
│                                                               │
│  5. Runtime State Creation                                    │
│     ├→ createGatewayRuntimeState() 创建:                      │
│     │   ├── HTTP Server(s) (可多个绑定地址)                   │
│     │   ├── WebSocketServer (noServer: true 模式)             │
│     │   ├── Canvas Host Handler                               │
│     │   ├── Client Set + Broadcaster                          │
│     │   └── Chat Run State + Dedupe Map                       │
│     └→ 产出: wss, httpServer, broadcast 等                    │
│                                                               │
│  6. Subsystem Wiring                                          │
│     ├→ NodeRegistry (设备注册表)                               │
│     ├→ Cron Service (定时任务)                                 │
│     ├→ Channel Manager (通道管理)                              │
│     ├→ Maintenance Timers (tick/health/dedupe/media)          │
│     ├→ Agent/Heartbeat/Transcript/Lifecycle 事件处理器        │
│     ├→ ExecApprovalManager (执行审批)                          │
│     └→ applyGatewayLaneConcurrency() (并发限制)               │
│                                                               │
│  7. WebSocket Handler Attachment                              │
│     └→ attachGatewayWsHandlers({                              │
│          wss, clients, resolvedAuth, gatewayMethods,          │
│          extraHandlers: { pluginHandlers, execApprovals,      │
│                           secretsHandlers },                  │
│          context: gatewayRequestContext                        │
│        })                                                     │
│                                                               │
│  8. Sidecar Startup                                           │
│     ├→ Browser Control Server (CDP)                           │
│     ├→ Plugin Services                                        │
│     ├→ Channel Startup (startChannels)                        │
│     └→ gateway_start 插件钩子                                  │
│                                                               │
│  9. Config Hot-Reload Watcher                                 │
│     └→ startGatewayConfigReloader({                           │
│          onHotReload: applyHotReload,                         │
│          onRestart: requestGatewayRestart                     │
│        })                                                     │
│                                                               │
│  10. Close Handler Assembly                                   │
│      └→ createGatewayCloseHandler() 按逆序拆除所有子系统     │
│          + gateway_stop 钩子 + 速率限制器清理                  │
└──────────────────────────────────────────────────────────────┘
```

### WebSocket 创建（真实代码）

```typescript
// src/gateway/server-runtime-state.ts
const wss = new WebSocketServer({
  noServer: true,           // HTTP upgrade 手动处理
  maxPayload: MAX_PREAUTH_PAYLOAD_BYTES,  // 认证前限制 payload 大小
});

// 每个 HTTP Server 都附加 upgrade handler
for (const server of httpServers) {
  attachGatewayUpgradeHandler({
    httpServer: server,
    wss,
    canvasHost,              // Canvas WS 路径分流
    clients,
    resolvedAuth: params.resolvedAuth,
    rateLimiter: params.rateLimiter,
  });
}
```

关键设计: WebSocket 使用 `noServer: true` 模式——HTTP server 的 `upgrade` 事件被 `attachGatewayUpgradeHandler` 拦截，**在完成握手之前执行认证**。Canvas WS 路径 (`/__openclaw__/canvas/`) 被分流到 Canvas WS 服务器。

## WebSocket 协议

### 连接生命周期

```
Client                          Gateway
  │                               │
  │── ws://127.0.0.1:18789 ──────│  1. 建立 WebSocket 连接
  │                               │     (upgrade 时先验证 auth)
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

```typescript
// 请求
{ type: "req", id: string, method: string, params: object }

// 响应
{ type: "res", id: string, ok: boolean, payload?: object, error?: {code, message} }

// 事件（服务器推送）
{ type: "event", event: string, payload: object, seq?: number, stateVersion?: number }
```

### 核心方法与事件

| 方法 | 描述 | | 事件 | 描述 |
|------|------|-|------|------|
| `connect` | 握手（必须是第一帧） | | `agent` | Agent 流式输出 |
| `health` | 健康状态查询 | | `chat` | 聊天消息事件 |
| `agent` | 触发 Agent 执行 | | `presence` | 在线状态变更 |
| `sessions.list` | 列出会话 | | `health` | 健康状态变更 |
| `sessions.send` | 向指定会话发送 | | `heartbeat` | 心跳 |
| `cron.*` | Cron 任务管理 | | `session.message` | 会话消息推送 |
| `channels.*` | 通道管理 | | `sessions.changed` | 会话变更推送 |
| `plugins.*` | 插件管理 | | `voicewake.changed` | 唤醒词变更 |
| `config.*` | 配置管理 | | `shutdown` | 关闭通知 |

## 认证系统（auth.ts）

### 认证模式类型

```typescript
// 解析后的认证模式
export type ResolvedGatewayAuthMode = "none" | "token" | "password" | "trusted-proxy";

// 认证结果
export type GatewayAuthResult = {
  ok: boolean;
  method?: "none" | "token" | "password" | "tailscale"
         | "device-token" | "bootstrap-token" | "trusted-proxy";
  user?: string;
  reason?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
};
```

### 授权决策树

`authorizeGatewayConnect` 按以下顺序决策：

```
1. Trusted-proxy 模式
   ├── 检查远程地址是否在信任代理列表
   ├── 从配置的 header 提取用户身份
   └── 验证 allowUsers 白名单

2. None 模式 → 直接通过

3. 速率限制检查
   └── limiter.check(ip, scope) 先于凭据比较

4. Tailscale header 认证（仅 WS Control UI）
   └── 通过 whois 查询验证 Tailscale-User-Login header

5. Token 模式
   └── 常量时间比较 safeEqualSecret()

6. Password 模式
   └── 同上常量时间比较
```

### 关键安全设计：速率限制不惩罚缺失凭据

```typescript
// 缺失凭据不消耗速率限制配额（防止探测）
if (!connectAuth?.token) {
  return { ok: false, reason: "token_missing" };  // 不调用 recordFailure
}
// 实际不匹配才惩罚
if (!safeEqualSecret(connectAuth.token, auth.token)) {
  limiter?.recordFailure(ip, rateLimitScope);      // 记录失败
  return { ok: false, reason: "token_mismatch" };
}
// 成功清除所有失败记录
limiter?.reset(ip, rateLimitScope);
```

### 设备签名验证（device-auth.ts）

使用 Ed25519 签名，版本化的管道分隔 payload 格式：

```typescript
export function buildDeviceAuthPayloadV3(params: DeviceAuthPayloadV3Params): string {
  return [
    "v3", params.deviceId, params.clientId, params.clientMode,
    params.role, params.scopes.join(","), String(params.signedAtMs),
    params.token ?? "", params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),    // 绑定平台
    normalizeDeviceMetadataForAuth(params.deviceFamily), // 绑定设备族
  ].join("|");
}
```

V3 格式额外绑定 `platform` + `deviceFamily`，防止元数据篡改。签名验证容忍 2 分钟时间偏差。

### 速率限制器（auth-rate-limit.ts）

滑动窗口内存速率限制器，按作用域独立追踪：

```typescript
export interface RateLimitConfig {
  maxAttempts?: number;     // 默认 10
  windowMs?: number;        // 默认 60_000 (1 分钟)
  lockoutMs?: number;       // 默认 300_000 (5 分钟)
  exemptLoopback?: boolean; // 默认 true (localhost 永不锁定)
  pruneIntervalMs?: number; // 默认 60_000
}

// 三个独立的速率限制作用域
export const AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET = "shared-secret";
export const AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN = "device-token";
export const AUTH_RATE_LIMIT_SCOPE_HOOK_AUTH = "hook-auth";
```

使用 `Map<string, RateLimitEntry>` 以 `"${scope}:${ip}"` 为键，通过 `setInterval` 定期自动清理（`.unref()` 允许进程正常退出）。

## HTTP 分阶段管道（server-http.ts）

HTTP 请求管道使用分阶段架构，每个请求按顺序经过各阶段直到被处理：

```
HTTP 请求 → setDefaultSecurityHeaders()
         → 路由匹配（按优先级）:

阶段 1: Health Probes
  /health, /healthz → liveness check
  /ready, /readyz   → readiness check (可选详细信息)

阶段 2: Hooks (/hooks/...)
  ├── extractHookToken() 提取认证
  ├── resolveHookIdempotencyKey() 幂等性检查
  ├── normalizeAgentPayload() 标准化请求
  └── dispatchAgentHook() 分发到 Agent

阶段 3: Tools Invoke
  └── handleToolsInvokeHttpRequest()

阶段 4: Sessions
  ├── handleSessionKillHttpRequest()
  └── handleSessionHistoryHttpRequest()

阶段 5: Slack Callback
  └── handleSlackHttpRequest()

阶段 6: OpenResponses (可选)
  └── POST /v1/responses (OpenAI 兼容)

阶段 7: Chat Completions (可选)
  └── POST /v1/chat/completions (OpenAI 兼容)

阶段 8: Canvas
  ├── authorizeCanvasRequest()
  └── 代理到 Canvas Host Server

阶段 9: Plugin Routes
  ├── resolvePluginRoutePathContext()
  ├── enforcePluginRouteGatewayAuth()
  └── handlePluginRequest()

阶段 10: Control UI
  ├── handleControlUiAvatarRequest()
  └── handleControlUiHttpRequest() (SPA)
```

WebSocket 升级绕过 HTTP 管道，由 `attachGatewayUpgradeHandler` 拦截分发。

## 配置热重载（config-reload.ts）

### 文件监听

使用 **chokidar** 监听配置文件变更：

```typescript
const watcher = chokidar.watch(opts.watchPath, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  usePolling: Boolean(process.env.VITEST),  // 测试环境用轮询
});
watcher.on("add", schedule);
watcher.on("change", schedule);
watcher.on("unlink", schedule);
```

### 重载模式

```typescript
export type GatewayReloadSettings = {
  mode: GatewayReloadMode;   // "off" | "restart" | "hot" | "hybrid"
  debounceMs: number;        // 默认 300
};
```

### 差异检测与重载规划（config-reload-plan.ts）

变更路径通过有序规则表映射到重载动作：

```typescript
type ReloadAction =
  | "reload-hooks"
  | "restart-gmail-watcher"
  | "restart-browser-control"
  | "restart-cron"
  | "restart-heartbeat"
  | "restart-health-monitor"
  | `restart-channel:${ChannelId}`;

// 规则示例:
// hooks.*          → hot reload + "reload-hooks"
// cron.*           → hot reload + "restart-cron"
// channels.*       → hot reload + "restart-channel:*"
// gateway.*        → full restart (需要重启)
// plugins.*        → full restart
// discovery.*      → full restart
// agents.*, tools.*, session.* → "none" (按需读取，无需重载)
// 未匹配路径      → force restart
```

`hybrid` 模式（默认）尽可能热重载，不可热重载的才重启。配置文件暂时缺失时最多重试 2 次（150ms 间隔），处理编辑器保存竞态。

### 重载编排（真实代码）

```typescript
// server.impl.ts 中的重载器设置
const configReloader = startGatewayConfigReloader({
  initialConfig: cfgAtStart,
  readSnapshot: readConfigFileSnapshot,
  onHotReload: async (plan, nextConfig) => {
    // 先激活新密钥
    const prepared = await activateRuntimeSecrets(nextConfig, {
      reason: "reload", activate: true,
    });
    try {
      await applyHotReload(plan, prepared.config);
    } catch (err) {
      // 失败时回滚密钥快照
      if (previousSnapshot) activateSecretsRuntimeSnapshot(previousSnapshot);
      throw err;
    }
  },
  onRestart: async (plan, nextConfig) => {
    await activateRuntimeSecrets(nextConfig, { reason: "restart-check", activate: false });
    requestGatewayRestart(plan, nextConfig);
  },
  watchPath: configSnapshot.path,
});
```

## 并发控制（Lanes）

Gateway 使用 Lane 概念控制并发，分为四种独立队列：

```typescript
// src/process/lanes.ts
export const enum CommandLane {
  Main = "main",         // 主 Agent 运行
  Cron = "cron",         // Cron 定时任务
  Subagent = "subagent", // 子 Agent
  Nested = "nested",     // 内部嵌套调用
}

// src/gateway/server-lanes.ts — 启动时应用并发限制
export function applyGatewayLaneConcurrency(cfg: ReturnType<typeof loadConfig>) {
  setCommandLaneConcurrency(CommandLane.Cron, cfg.cron?.maxConcurrentRuns ?? 1);
  setCommandLaneConcurrency(CommandLane.Main, resolveAgentMaxConcurrent(cfg));
  setCommandLaneConcurrency(CommandLane.Subagent, resolveSubagentMaxConcurrent(cfg));
}
```

## 通道生命周期（server-channels.ts）

### 核心类型

```typescript
export type ChannelManager = {
  getRuntimeSnapshot: () => ChannelRuntimeSnapshot;
  startChannels: () => Promise<void>;
  startChannel: (channel: ChannelId, accountId?: string) => Promise<void>;
  stopChannel: (channel: ChannelId, accountId?: string) => Promise<void>;
  markChannelLoggedOut: (channelId, cleared, accountId?) => void;
  isManuallyStopped: (channelId, accountId) => boolean;
  resetRestartAttempts: (channelId, accountId) => void;
  isHealthMonitorEnabled: (channelId, accountId) => boolean;
};
```

### 指数退避重启策略

```typescript
const CHANNEL_RESTART_POLICY: BackoffPolicy = {
  initialMs: 5_000,      // 首次 5 秒
  maxMs: 5 * 60_000,     // 最大 5 分钟
  factor: 2,             // 指数因子
  jitter: 0.1,           // 10% 抖动
};
const MAX_RESTART_ATTEMPTS = 10;
```

重启逻辑：
1. 递增 per-account 重启计数
2. 超过 `MAX_RESTART_ATTEMPTS` (10) → 永久放弃
3. 计算退避延迟 `computeBackoff(policy, attempt)`
4. 使用 `AbortSignal` 等待（手动停止可取消）
5. 递归调用 `startChannelInternal()` 并设置 `preserveRestartAttempts: true`
6. 成功启动后重置重启计数

### 每通道运行时存储

```typescript
type ChannelRuntimeStore = {
  aborts: Map<string, AbortController>;     // 取消控制
  starting: Map<string, Promise<void>>;     // 启动门（防止并发启动）
  tasks: Map<string, Promise<unknown>>;     // 运行中任务
  runtimes: Map<string, ChannelAccountSnapshot>; // 账号运行快照
};
```

## BOOT.md 执行（boot.ts）

Gateway 启动时可选执行工作空间中的 `BOOT.md` 文件：

```typescript
export type BootRunResult =
  | { status: "skipped"; reason: "missing" | "empty" }
  | { status: "ran" }
  | { status: "failed"; reason: string };

export async function runBootOnce(params: {
  cfg: OpenClawConfig;
  deps: CliDeps;
  workspaceDir: string;
  agentId?: string;
}): Promise<BootRunResult>
```

### Boot Prompt 构造

```typescript
function buildBootPrompt(content: string) {
  return [
    "You are running a boot check. Follow BOOT.md instructions exactly.",
    "", "BOOT.md:", content, "",
    "If BOOT.md asks you to send a message, use the message tool.",
    `After sending, reply with ONLY: ${SILENT_REPLY_TOKEN}.`,
    `If nothing needs attention, reply with ONLY: ${SILENT_REPLY_TOKEN}.`,
  ].join("\n");
}
```

### 会话快照/恢复

执行前保存主会话映射，执行后恢复，避免污染用户的会话：

```typescript
const mappingSnapshot = snapshotMainSessionMapping({ cfg, sessionKey });
// ... 运行 boot agent ...
const mappingRestoreFailure = await restoreMainSessionMapping(mappingSnapshot);
```

## 健康监控

```
channel-health-monitor.ts:
├── 可配置检查间隔 (默认 5 分钟)
├── 可配置过期事件阈值 (staleEventThresholdMinutes)
├── 最大每小时重启次数限制 (maxRestartsPerHour)
├── 三级配置覆盖: per-account > per-channel > default(true)
└── 通过 event:health 推送给所有客户端

server/health-state.ts:
├── 维护全局健康快照缓存
├── 每次变更递增 healthVersion
├── 客户端可通过版本号增量获取
└── 包含：通道状态、Agent 状态、队列深度
```

## 安全架构（11 层）

```
1.  传输安全    — TLS 支持，非 loopback 的明文 ws:// 会收到警告
2.  认证模式    — Token / Password / Tailscale / Trusted-Proxy / None
3.  设备身份    — Ed25519 密钥对，v3 payload 绑定 platform+deviceFamily
                  基于 nonce 的 challenge-response，容忍 2 分钟时间偏差
4.  设备配对    — 首次连接审批流，绑定角色/作用域
5.  速率限制    — per-IP 滑动窗口（10次/60秒，锁定5分钟）
                  按作用域独立追踪（shared-secret/device-token/hook-auth）
                  缺失凭据不消耗配额，localhost 免锁定
6.  Origin 检查 — 浏览器客户端必须通过 allowed origins 验证
7.  RBAC        — 角色级（operator/node）+ 作用域级
                  (admin/read/write/approvals/pairing)
8.  控制平面限速 — 写方法限制 3次/60秒/客户端
9.  慢消费者保护 — bufferedAmount 过高的客户端被断开（close 1008）
10. 预认证限制  — 认证前消息有更小的 payload 限制 (MAX_PREAUTH_PAYLOAD_BYTES)
11. 未授权洪泛  — 重复未授权请求触发连接关闭
```

## Gateway 关闭流程

`close()` 方法按逆序拆除所有子系统：

```typescript
// server.impl.ts 尾部
return {
  close: async (opts) => {
    // 1. 运行 gateway_stop 插件钩子
    await runGlobalGatewayStopSafely({ event: { reason }, ctx: { port } });
    // 2. 停止诊断心跳
    if (diagnosticsEnabled) stopDiagnosticHeartbeat();
    // 3. 清理 Skills 刷新定时器
    skillsChangeUnsub();
    // 4. 释放速率限制器
    authRateLimiter?.dispose();
    browserAuthRateLimiter.dispose();
    // 5. 停止模型定价刷新
    stopModelPricingRefresh();
    // 6. 停止通道健康监控
    channelHealthMonitor?.stop();
    // 7. 清除密钥运行时快照
    clearSecretsRuntimeSnapshot();
    // 8. 执行完整关闭（通道、cron、heartbeat、WS、HTTP...）
    await close(opts);
  },
};
```
