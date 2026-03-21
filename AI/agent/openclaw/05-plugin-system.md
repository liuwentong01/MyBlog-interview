# 05 - 插件/扩展系统

## 概述

OpenClaw 的插件系统是其最具特色的架构设计之一。它采用 "核心精简，能力外扩" 的理念，将大量功能以插件形式实现，包括消息通道、LLM 提供者、记忆系统、搜索引擎等。

## 插件系统架构

### 核心组件

```
src/plugins/
├── loader.ts                # 主加载编排器（Jiti 动态导入 + SDK 别名映射）
├── discovery.ts             # 插件目录扫描（4 来源 + 安全检查 + 缓存）
├── manifest.ts              # openclaw.plugin.json 解析与校验
├── registry.ts              # 插件注册表 + OpenClawPluginApi 工厂
├── registry-empty.ts        # 空注册表创建
├── types.ts                 # 所有插件类型定义（含 25 个钩子事件类型）
├── hooks.ts                 # 钩子运行器（优先级排序 + 4 种执行模式）
├── slots.ts                 # 排他性 Slot 系统（memory、context-engine）
├── runtime/                 # 插件运行时
│   ├── index.ts             # 运行时创建
│   └── types.ts             # PluginRuntime 类型（深度内部访问）
├── hook-runner-global.ts    # 全局钩子运行器（globalThis 单例）
├── services.ts              # 插件服务句柄（start/stop 生命周期）
├── commands.ts              # 插件命令注册
├── http-path.ts             # HTTP 路径规范化
├── http-route-overlap.ts    # HTTP 路由重叠检测
├── interactive.ts           # 交互式处理器注册
├── provider-validation.ts   # Provider 注册验证
├── provider-auth-types.ts   # 认证类型定义
├── provider-oauth-flow.ts   # OAuth 流程
├── path-safety.ts           # 路径安全检查
├── roots.ts                 # 插件源根解析
├── bundle-manifest.ts       # Bundle 清单加载
└── channel-plugin-ids.ts    # 通道插件 ID 解析

src/plugin-sdk/
├── index.ts                 # SDK 入口（插件可导入的公共 API）
├── core.ts                  # 核心 SDK（definePluginEntry, defineChannelPluginEntry）
├── plugin-entry.ts          # 轻量级非通道插件入口定义
├── routing.ts               # 路由 SDK
├── runtime.ts               # 运行时 SDK
├── sandbox.ts               # 沙箱 SDK
├── provider-setup.ts        # 提供者设置
├── self-hosted-provider-setup.ts
├── ollama-setup.ts          # Ollama 设置
└── account-id.ts            # 账号 ID 工具
```

### 插件发现（Discovery）

插件从 4 个来源按优先级发现：

```
优先级（高→低）:

1. config (origin: "config")
   └── plugins.load.paths 中显式配置的路径

2. workspace (origin: "workspace")
   └── <workspace>/extensions/ 目录（per-agent 作用域）

3. bundled (origin: "bundled")
   └── OpenClaw 自带的 extensions/ 目录

4. global (origin: "global")
   └── ~/.openclaw/extensions/ 目录（用户安装，跨 agent 共享）
```

发现过程包含**安全检查**：拒绝 world-writable 路径、可疑文件所有权、逃逸插件根目录的符号链接、非 bundled 插件中的硬链接。

Discovery 实现细节（来自 `src/plugins/discovery.ts`）：

```typescript
// 插件候选者类型
type PluginCandidate = {
  idHint: string;          // 插件 ID 提示
  source: string;          // 入口文件路径
  setupSource?: string;    // 设置入口路径
  rootDir: string;         // 插件根目录
  origin: PluginOrigin;    // "config" | "workspace" | "bundled" | "global"
  format?: PluginFormat;
  bundleFormat?: PluginBundleFormat;
  workspaceDir?: string;
  packageName?: string;
  packageVersion?: string;
};

// 安全检查阻止原因
type CandidateBlockReason =
  | "source_escapes_root"        // 符号链接逃逸插件根目录
  | "path_stat_failed"           // 路径状态获取失败
  | "path_world_writable"        // 路径是 world-writable
  | "path_suspicious_ownership"; // 可疑的文件所有权

// Discovery 结果带短时缓存（1s），收拢启动时的突发重载
const DEFAULT_DISCOVERY_CACHE_MS = 1000;
```

### 插件声明文件

每个插件必须有一个 `openclaw.plugin.json` 清单：

```json
{
  "id": "telegram",
  "configSchema": {},
  "channels": ["telegram"],
  "providerAuthEnvVars": {},
  "providerAuthChoices": [],
  "skills": [],
  "enabledByDefault": true,
  "name": "Telegram",
  "description": "Telegram messaging channel"
}
```

关键字段说明：
- `id` — 唯一标识符（必需）
- `configSchema` — 插件配置的 JSON Schema（必需）
- `kind` — `"memory"` | `"context-engine"`（用于 Slot 系统，可选）
- `channels` — 提供的通道 ID 列表（可选）
- `providers` — 提供的模型提供者 ID 列表（可选）
- `providerAuthEnvVars` — 认证环境变量映射（可选）
- `skills` — 随插件发布的 Skills（可选）
- `enabledByDefault` — 是否默认启用（可选）

### 插件类型

```
kind 类型:
├── "channel"          # 消息通道（telegram, discord, whatsapp...）
├── "provider"         # LLM 提供者（openai, anthropic, google...）
├── "memory"           # 记忆系统（memory-core, memory-lancedb）
├── "context-engine"   # 上下文引擎
├── "tool"             # 工具扩展（browser, firecrawl, tavily...）
├── "integration"      # 集成插件（diagnostics-otel, device-pair）
└── "general"          # 通用插件
```

### 核心类型定义（来自源码）

```typescript
// src/plugins/registry.ts — 插件记录
type PluginRecord = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  format?: PluginFormat;
  bundleFormat?: PluginBundleFormat;
  kind?: PluginKind;              // "memory" | "context-engine"
  source: string;                 // 入口文件路径
  rootDir?: string;
  origin: PluginOrigin;           // "config"|"workspace"|"bundled"|"global"
  enabled: boolean;
  status: "loaded" | "disabled" | "error";
  error?: string;
  // 注册的各类组件计数
  toolNames: string[];
  hookNames: string[];
  channelIds: string[];
  providerIds: string[];
  speechProviderIds: string[];
  mediaUnderstandingProviderIds: string[];
  imageGenerationProviderIds: string[];
  webSearchProviderIds: string[];
  gatewayMethods: string[];
  cliCommands: string[];
  services: string[];
  commands: string[];
  httpRoutes: number;
  hookCount: number;
  configSchema: boolean;
};

// src/plugins/registry.ts — 插件注册表（中央数据结构）
type PluginRegistry = {
  plugins: PluginRecord[];                    // 所有插件记录
  tools: PluginToolRegistration[];            // 工具注册
  hooks: PluginHookRegistration[];            // 钩子注册
  typedHooks: TypedPluginHookRegistration[];  // 类型化钩子
  channels: PluginChannelRegistration[];      // 通道插件
  channelSetups: PluginChannelSetupRegistration[]; // 通道设置入口
  providers: PluginProviderRegistration[];    // LLM Provider
  speechProviders: ...;                       // TTS Provider
  mediaUnderstandingProviders: ...;           // 媒体理解 Provider
  imageGenerationProviders: ...;              // 图片生成 Provider
  webSearchProviders: ...;                    // 网页搜索 Provider
  gatewayHandlers: GatewayRequestHandlers;    // Gateway WS 方法
  httpRoutes: PluginHttpRouteRegistration[];  // HTTP 路由
  cliRegistrars: PluginCliRegistration[];     // CLI 命令
  services: PluginServiceRegistration[];      // 服务句柄
  commands: PluginCommandRegistration[];      // 插件命令
  conversationBindingResolvedHandlers: ...;   // 会话绑定解析处理器
  diagnostics: PluginDiagnostic[];            // 诊断信息
};
```

## 插件生命周期

```
┌──────────────────────────────────────────────┐
│              插件加载流程                      │
│                                               │
│  1. Gateway 启动                              │
│     └→ loadGatewayPlugins()                   │
│                                               │
│  2. 扫描 extensions/ 目录                     │
│     └→ 每个子目录检查 openclaw.plugin.json    │
│                                               │
│  3. 检查启用状态                              │
│     └→ config.plugins.entries[id].enabled     │
│                                               │
│  4. 解析依赖                                  │
│     └→ 检查 peerDependencies                  │
│                                               │
│  5. 加载插件代码                              │
│     └→ 动态导入 entry 文件                    │
│     └→ 调用 default export (register 函数)     │
│                                               │
│  6. 注册到插件注册表                          │
│     └→ 调用 api.registerChannel() /           │
│        api.registerProvider() /               │
│        api.registerContextEngine() / ...       │
│                                               │
│  7. 初始化                                    │
│     └→ 建立通道连接 / 加载模型目录 / ...       │
│                                               │
│  8. 运行中                                    │
│     └→ 处理事件、响应请求                     │
│                                               │
│  9. 关闭                                      │
│     └→ dispose() 清理资源                     │
└──────────────────────────────────────────────┘
```

## Plugin SDK API

### PluginRuntime（深度内部访问）

受信任的插件通过 `api.runtime` 获得对 OpenClaw 内部的深度访问：

```typescript
runtime.config           // 加载/写入配置文件
runtime.agent            // Agent 目录解析、嵌入式 pi-agent 运行器、会话存储
runtime.subagent         // 创建和管理子 Agent（run, waitForRun, getSessionMessages）
runtime.channel          // 通道特定运行时操作
runtime.system           // 系统事件、心跳、进程执行
runtime.media            // 媒体加载、MIME 检测、图片缩放
runtime.tts / runtime.stt     // TTS / STT
runtime.mediaUnderstanding    // 视觉描述、音频转录
runtime.imageGeneration       // 图片生成
runtime.webSearch             // 网页搜索
runtime.tools                 // 记忆工具工厂
runtime.events                // Agent 事件监听器、转录更新监听器
runtime.logging               // 日志
runtime.state                 // 状态目录解析
runtime.modelAuth             // 解析模型/提供者的 API Key
```

### 注册模式

插件有三种注册模式：

```
"full"          — 完全注册（工具、钩子、提供者等全部注册）
"setup-only"    — 仅注册通道插件（用于未配置的通道启用设置向导）
"setup-runtime" — 轻量通道注册（已配置的通道延迟到 Gateway listen 后完全加载）
```

### 通道插件 API

```typescript
// extensions/telegram/index.ts 示例结构
export default function register(api: PluginAPI) {
  api.registerChannel("telegram", {
    // 通道信息
    info: {
      id: "telegram",
      displayName: "Telegram",
      supportsGroups: true,
      supportsThreads: true,    // Forum topics
      supportsReactions: true,
    },

    // 启动通道连接
    async start(config) {
      const bot = new Bot(config.botToken);
      bot.on("message", (ctx) => {
        // 标准化消息并转发给 Gateway
        api.onInboundMessage({
          channel: "telegram",
          from: String(ctx.from.id),
          text: ctx.message.text,
          // ...更多字段
        });
      });
      await bot.start();
    },

    // 发送消息到通道
    async send(params) {
      await bot.api.sendMessage(params.to, params.text);
    },

    // 通道状态
    async status() {
      return { connected: true, botUsername: "..." };
    },

    // 清理
    async dispose() {
      await bot.stop();
    }
  });
}
```

### Provider 插件 API

```typescript
// extensions/openai/index.ts 示例结构
export default function register(api: PluginAPI) {
  api.registerProvider("openai", {
    // 模型目录
    catalog: [
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        contextWindow: 256000,
        maxTokens: 32000,
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3.75 },
      },
      // ... 更多模型
    ],

    // 认证流程
    auth: [{
      label: "API Key",
      async run() { /* 交互式设置 */ },
      async runNonInteractive(opts) { /* 无头设置 */ },
    }],

    // Onboarding UI
    wizard: {
      setup: [{ label: "OpenAI API Key", value: "openai-api-key" }],
      modelPicker: { models: [...] },
    },

    // 运行时能力
    capabilities: {
      providerFamily: "openai",
      supportsToolStreaming: true,
    },

    // 动态模型解析
    async resolveDynamicModel(modelId) {
      // 允许任意 model ID pass-through
    },

    // 请求定制
    async prepareExtraParams(model, params) {
      return { ...params, stream: true };
    },

    // 请求包装
    async wrapStreamFn(fn, model) {
      return async (req) => {
        // 添加自定义 headers
        req.headers["X-Custom"] = "value";
        return fn(req);
      };
    },
  });
}
```

### 记忆插件 API

```typescript
// extensions/memory-lancedb/index.ts 示例
export default function register(api: PluginAPI) {
  api.registerMemoryPlugin("memory-lancedb", {
    info: {
      id: "memory-lancedb",
      name: "LanceDB Memory",
    },

    // 搜索记忆
    async search(query, options) {
      // 向量搜索 + BM25 混合搜索
      return results;
    },

    // 读取记忆文件
    async get(path, lineRange) {
      return { text: "...", path };
    },

    // 索引更新
    async index(files) {
      // 重建向量索引
    },

    // 清理
    async dispose() { /* ... */ }
  });
}
```

### Context Engine 插件 API

```typescript
api.registerContextEngine("my-engine", () => ({
  info: {
    id: "my-engine",
    name: "My Context Engine",
    ownsCompaction: true,     // 是否接管压缩
  },

  // 消息入库
  async ingest({ sessionId, message, isHeartbeat }) {
    return { ingested: true };
  },

  // 上下文组装
  async assemble({ sessionId, messages, tokenBudget }) {
    return {
      messages: buildContext(messages, tokenBudget),
      estimatedTokens: countTokens(messages),
      systemPromptAddition: "Use lcm_grep to search history...",
    };
  },

  // 压缩
  async compact({ sessionId, force }) {
    return { ok: true, compacted: true };
  },

  // 后续处理（可选）
  async afterTurn({ sessionId, messages }) { /* ... */ },

  // 子 Agent 结束（可选）
  async onSubagentEnded({ parentSessionId, childSessionId }) { /* ... */ },
}));
```

## 生命周期钩子系统（25 个钩子）

插件通过 `api.on(hookName, handler, { priority })` 注册钩子。共有 4 种执行模式：

### 1. Void 钩子（fire-and-forget，并行执行）
```
agent_end             — Agent 执行结束
llm_input             — LLM 请求发送前
llm_output            — LLM 响应接收后
before_compaction     — 压缩前
after_compaction      — 压缩后
before_reset          — 会话重置前
message_received      — 收到消息
message_sent          — 消息发送后
after_tool_call       — 工具调用后
session_start         — 会话开始
session_end           — 会话结束
subagent_spawned      — 子 Agent 创建后
subagent_ended        — 子 Agent 结束后
gateway_start         — Gateway 启动
gateway_stop          — Gateway 停止
```

### 2. Modifying 钩子（顺序执行，结果合并）
```
before_model_resolve  — 模型解析前（可修改模型选择）
before_prompt_build   — 提示构建前（可注入上下文）
before_agent_start    — Agent 启动前（可修改参数）
message_sending       — 消息发送中（可修改内容）
before_tool_call      — 工具调用前（可修改参数）
subagent_spawning     — 子 Agent 创建中
subagent_delivery_target — 子 Agent 投递目标
```

### 3. Claiming 钩子（顺序执行，first-handled-wins）
```
inbound_claim         — 入站消息认领（第一个处理者获胜）
```

### 4. Synchronous 钩子（热路径，无 async）
```
tool_result_persist   — 工具结果持久化
before_message_write  — 消息写入前
```

**安全特性：** `before_prompt_build` 和 `before_agent_start` 被分类为 "prompt injection" 钩子，受 `plugins.entries.<id>.hooks.allowPromptInjection` 策略控制。

### 钩子运行器实现（来自源码）

```typescript
// src/plugins/hooks.ts — 钩子按优先级排序
function getHooksForName<K extends PluginHookName>(
  registry: PluginRegistry,
  hookName: K,
): PluginHookRegistration<K>[] {
  return (registry.typedHooks as PluginHookRegistration<K>[])
    .filter((h) => h.hookName === hookName)
    .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    // 优先级高的先执行（降序排列）
}

// 钩子运行器选项
type HookRunnerOptions = {
  logger?: HookRunnerLogger;
  catchErrors?: boolean;  // 捕获错误并记录而不是抛出
};
```

### Prompt Injection 安全控制

```typescript
// 未授权的 prompt injection 钩子会被约束
// before_agent_start 的遗留兼容：剥离 prompt 修改字段
const constrainLegacyPromptInjectionHook = (
  handler: PluginHookHandlerMap["before_agent_start"],
): PluginHookHandlerMap["before_agent_start"] => {
  return (event, ctx) => {
    const result = handler(event, ctx);
    // 同步和异步结果都经过 stripPromptMutationFields 处理
    return stripPromptMutationFieldsFromLegacyHookResult(result);
  };
};

// 配置控制:
// plugins.entries.<pluginId>.hooks.allowPromptInjection = true
// 只有显式授权的插件才能通过 before_prompt_build 注入上下文
```

## 插件 Slot 系统

某些插件类型是**排他性**的（同一时间只能有一个活跃）。来自 `src/plugins/slots.ts`：

```typescript
// Kind → Slot 映射
const SLOT_BY_KIND: Record<PluginKind, PluginSlotKey> = {
  memory: "memory",
  "context-engine": "contextEngine",
};

// 默认 Slot 值
const DEFAULT_SLOT_BY_KEY: Record<PluginSlotKey, string> = {
  memory: "memory-core",
  contextEngine: "legacy",
};

// 排他性选择：选择新的 slot 插件时，自动禁用同类型的其他插件
function applyExclusiveSlotSelection(params: {
  config: OpenClawConfig;
  selectedId: string;
  selectedKind?: PluginKind;
  registry?: { plugins: SlotPluginRecord[] };
}): SlotSelectionResult {
  // 1. 获取 slot key（memory 或 contextEngine）
  // 2. 设置新的 slot 值
  // 3. 遍历同类型的其他插件，设置 enabled: false
  // 4. 返回更新后的 config + warnings
}
```

配置示例：

```json5
{
  plugins: {
    slots: {
      contextEngine: "legacy",       // 上下文引擎（默认 "legacy"）
      memory: "memory-core",         // 记忆系统（"none" 禁用）
    },
    entries: {
      "memory-lancedb": {
        enabled: true,
        // 插件特定配置
      },
      "lossless-claw": {
        enabled: true,
      }
    }
  }
}
```

## 插件工具注册（来自源码）

```typescript
// src/plugins/registry.ts — 工具注册类型
type PluginToolRegistration = {
  pluginId: string;
  pluginName?: string;
  factory: OpenClawPluginToolFactory;  // 上下文感知的工厂函数
  names: string[];                     // 工具名称列表
  optional: boolean;                   // 是否可选
  source: string;
  rootDir?: string;
};

// src/plugins/types.ts — 工具上下文
type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;           // 每次 /new 和 /reset 重新生成
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;   // 受信任的发送者 ID（运行时提供）
  senderIsOwner?: boolean;      // 是否为 owner
  sandboxed?: boolean;
};

// 工厂模式：根据上下文动态创建工具
type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;
// 返回 null/undefined 表示此上下文下工具不可用
```

## 插件 Provider 认证（来自源码）

```typescript
// src/plugins/types.ts — 认证类型
type ProviderAuthKind = "oauth" | "api_key" | "token" | "device_code" | "custom";

type ProviderAuthResult = {
  profiles: Array<{
    profileId: string;              // 如 "provider:default" 或 "provider:user@email.com"
    credential: AuthProfileCredential;
  }>;
  configPatch?: Partial<OpenClawConfig>;  // 认证后的配置补丁
  defaultModel?: string;                   // 建议的默认模型
  notes?: string[];                        // 提示信息
};

type ProviderAuthContext = {
  config: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  prompter: WizardPrompter;       // 交互式提示器
  runtime: RuntimeEnv;
  opts?: ProviderAuthOptionBag;   // CLI 预设标志
  secretInputMode?: SecretInputMode;
  allowSecretRefPrompt?: boolean; // 是否提供密钥存储模式选择
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  oauth: {
    createVpsAwareHandlers: typeof createVpsAwareOAuthHandlers;
  };
};
```

## 插件安装与管理

### CLI 命令

```bash
# 从 npm 安装
openclaw plugins install @martian-engineering/lossless-claw

# 从本地路径安装（开发用）
openclaw plugins install -l ./my-plugin

# 启用/禁用
openclaw plugins enable my-plugin
openclaw plugins disable my-plugin

# 列出
openclaw plugins list

# 诊断
openclaw doctor
```

### 包结构

```
extensions/telegram/
├── openclaw.plugin.json   # 插件清单（必须）
├── package.json           # npm 包描述
├── index.ts               # 入口文件（register 函数）
├── api.ts                 # 内部 API 桶文件
├── runtime-api.ts         # 运行时 API 桶文件
├── setup-entry.ts         # Onboarding 设置入口
├── session-key-api.ts     # 会话键 API（部分插件）
└── src/                   # 实现细节
    ├── channel.ts         # 通道实现
    ├── send.ts            # 发送逻辑
    ├── group.ts           # 群组处理
    ├── media.ts           # 媒体处理
    └── ...
```

### 导入边界规则

这是一个**严格的架构约束**：

```
✅ 允许:
  extensions/telegram/src/channel.ts
    import { ... } from "openclaw/plugin-sdk"
    import { ... } from "openclaw/plugin-sdk/core"
    import { ... } from "openclaw/plugin-sdk/routing"
    import { ... } from "../api.ts"
    import { ... } from "../runtime-api.ts"

❌ 禁止:
  extensions/telegram/src/channel.ts
    import { ... } from "../../src/gateway/..."      // 不能引用核心代码
    import { ... } from "../../src/plugin-sdk/..."   // 不能直接引用 SDK 实现
    import { ... } from "../../../extensions/discord/..." // 不能引用其他插件
```

## 插件列表

### 通道插件 (Messaging Channels)

| 插件 | 平台 | 技术 |
|------|------|------|
| `telegram` | Telegram | grammY |
| `discord` | Discord | discord.js |
| `whatsapp` | WhatsApp | Baileys |
| `slack` | Slack | Bolt |
| `signal` | Signal | signal-cli |
| `bluebubbles` | iMessage | BlueBubbles API |
| `imessage` | iMessage (旧版) | 直接 imsg |
| `irc` | IRC | irc 库 |
| `msteams` | Microsoft Teams | Bot Framework |
| `matrix` | Matrix | matrix-js-sdk |
| `googlechat` | Google Chat | Chat API |
| `feishu` | 飞书 | 飞书开放平台 |
| `line` | LINE | Messaging API |
| `mattermost` | Mattermost | REST API |
| `nextcloud-talk` | Nextcloud Talk | API |
| `nostr` | Nostr | NIP 协议 |
| `synology-chat` | Synology Chat | Webhook |
| `tlon` | Tlon/Urbit | Tlon API |
| `twitch` | Twitch | TMI.js |
| `zalo` | Zalo OA | Zalo API |
| `zalouser` | Zalo 个人 | Zalo API |
| `voice-call` | 语音通话 | Twilio/ElevenLabs |

### Provider 插件 (LLM Models)

| 插件 | 提供者 | 示例模型 |
|------|--------|----------|
| `openai` | OpenAI | gpt-5.4 |
| `anthropic` | Anthropic | claude-opus-4-6 |
| `google` | Google Gemini | gemini-3.1-pro |
| `openrouter` | OpenRouter | 聚合多家 |
| `ollama` | Ollama | 本地模型 |
| `github-copilot` | GitHub Copilot | OAuth |
| `copilot-proxy` | Copilot 代理 | 代理模式 |
| `amazon-bedrock` | AWS Bedrock | 多家模型 |
| `microsoft` | Azure OpenAI | 微软托管 |
| `mistral` | Mistral | mistral-large |
| `xai` | xAI | Grok |
| `moonshot` | Moonshot | Kimi K2.5 |
| `zai` | Z.AI | GLM-5 |
| `minimax` | MiniMax | M2.5 |
| `qianfan` | 百度千帆 | 国内模型 |
| `modelstudio` | Model Studio | 多家模型 |
| `volcengine` | 火山引擎 | Doubao |
| `byteplus` | BytePlus | 国际版火山 |
| `together` | Together | 开源模型 |
| `nvidia` | NVIDIA | NVIDIA 模型 |
| `huggingface` | HuggingFace | 开源模型 |
| `perplexity` | Perplexity | 搜索增强 |
| `venice` | Venice | 隐私模型 |
| `vllm` | vLLM | 自托管 |
| `sglang` | SGLang | 自托管 |
| `qwen-portal-auth` | 通义千问 | OAuth |
| `kimi-coding` | Kimi Coding | 代码模型 |
| `kilocode` | Kilo Gateway | 聚合代理 |

### 功能插件

| 插件 | 功能 |
|------|------|
| `memory-core` | 内置记忆（Markdown + 搜索） |
| `memory-lancedb` | LanceDB 向量记忆 |
| `brave` | Brave Search 集成 |
| `tavily` | Tavily 搜索 |
| `firecrawl` | Firecrawl 网页抓取 |
| `elevenlabs` | ElevenLabs TTS |
| `lobster` | Lobster 人格系统 |
| `llm-task` | LLM 任务调度 |
| `diffs` | 差异可视化 |
| `open-prose` | 文档编辑 |
| `talk-voice` | Talk 模式语音 |
| `phone-control` | 手机控制 |
| `device-pair` | 设备配对 |
| `thread-ownership` | 线程所有权 |
| `diagnostics-otel` | OpenTelemetry 诊断 |
| `openshell` | Shell 集成 |
| `acpx` | ACP 扩展 |
