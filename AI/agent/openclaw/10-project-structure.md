# 10 - 项目工程结构与开发实践

## Monorepo 管理

### pnpm Workspace

> 源码：`pnpm-workspace.yaml`

```yaml
# pnpm-workspace.yaml
packages:
  - .              # 根包（openclaw 核心）
  - ui             # Control UI（Vite + Lit）
  - packages/*     # 遗留/兼容包（clawdbot, moltbot）
  - extensions/*   # 70+ 插件包
```

`onlyBuiltDependencies` 列表控制哪些原生模块在安装时编译：
- `@lydell/node-pty` — 终端模拟
- `@napi-rs/canvas` — Canvas 渲染
- `sharp` — 图片处理
- `node-llama-cpp` — 本地 LLM
- `esbuild` — 快速 JS 打包

### 包依赖关系

```
openclaw (根包)
├── dependencies: 核心运行时依赖
├── devDependencies: 构建/测试工具
│
├── ui/ (独立包)
│   └── 使用 Vite 构建，Lit 框架
│
├── extensions/* (70+ 独立包)
│   ├── devDependencies: openclaw (workspace:*)
│   ├── dependencies: 插件特有依赖
│   └── peerDependencies: openclaw (运行时解析)
│
└── packages/*
    ├── clawdbot/ (旧名兼容)
    └── moltbot/ (旧名兼容)
```

### 依赖规则

```
✅ 插件 → openclaw/plugin-sdk (公共 API)
✅ 插件 → 自己的 dependencies
❌ 插件 → 核心 src/** (绝对禁止)
❌ 插件 → 其他插件 (绝对禁止)
❌ 插件 → workspace:* 在 dependencies (npm install 会 break)
```

## 版本管理

> 源码：`package.json` — version 字段

### CalVer 版本格式

```
CLI: YYYY.M.D (例: 2026.3.14)
稳定版: vYYYY.M.D
Beta: vYYYY.M.D-beta.N
补丁: vYYYY.M.D-patch
```

**包管理器**：`pnpm@10.23.0`（通过 `packageManager` 字段锁定）

### 发布通道

```
stable → npm dist-tag: latest
beta   → npm dist-tag: beta
dev    → npm dist-tag: dev (从 main 分支发布时)
```

### 版本同步位置

```
package.json                              → CLI 版本 (2026.3.14)
apps/android/app/build.gradle.kts         → Android (versionName/versionCode)
apps/ios/Sources/Info.plist               → iOS (CFBundleShortVersionString)
apps/macos/.../Info.plist                 → macOS (CFBundleShortVersionString)
extensions/*/package.json                 → 所有扩展锁步同版本
```

## 构建系统

### 核心构建工具：tsdown

> 源码：`tsdown.config.ts`

tsdown 是基于 Rolldown（Rust 实现的打包器）的 TypeScript 构建工具：

```typescript
// tsdown.config.ts

export default defineConfig([
  nodeBuildConfig({
    entry: buildUnifiedDistEntries(),
    deps: {
      neverBundle: ["@lancedb/lancedb"],  // 原生模块不打包
    },
  }),
]);
```

**关键设计——统一构建图**：核心入口、plugin-sdk 子路径、扩展入口、钩子入口全部在一次构建中编译，确保**运行时单例只发射一次**：

```
buildUnifiedDistEntries() 产生的入口点:

1. 核心入口:
   ├── src/index.ts
   ├── src/entry.ts
   ├── src/cli/daemon-cli.ts
   └── src/extensionAPI.ts

2. Plugin SDK 子路径:
   └── src/plugin-sdk/*.ts (90+ 个)

3. 扩展入口（自动发现）:
   └── 读取 extensions/*/openclaw.plugin.json 清单
       ├── package.json#openclaw.extensions[] → 主入口
       └── package.json#openclaw.setupEntry → 设置向导入口

4. 内置钩子入口（自动发现）:
   └── 扫描 src/hooks/bundled/*/handler.ts

构建配置:
├── platform: "node"
├── fixedExtension: false
├── environment: NODE_ENV = "production" (编译时注入)
└── neverBundle: ["@lancedb/lancedb"] (原生模块排除)
```

### 构建命令

```bash
# 完整构建（多步骤）
pnpm build
# 步骤: tsdown → postbuild → plugin-sdk DTS 生成 → 资源复制 → build-info 写入

# Docker 精简构建（跳过 plugin-sdk DTS 和 A2UI bundle）
pnpm build:docker

# UI 构建
pnpm ui:build   # Vite 构建 Control UI
```

### 关键依赖一览

> 源码：`package.json` — dependencies/devDependencies

**运行时依赖**：
| 包 | 版本 | 用途 |
|---|---|---|
| `@sinclair/typebox` | 0.34 | 运行时配置验证（TypeBox schemas + ajv） |
| `@modelcontextprotocol/sdk` | 1.27 | MCP 支持 |
| `@agentclientprotocol/sdk` | 0.16 | ACP（Agent Client Protocol） |
| `@mariozechner/pi-*` | 0.60 | Pi Agent 核心/编码/TUI |
| `hono` | 4.12 | HTTP 框架 |
| `express` | 5.2 | 额外 HTTP 路由 |
| `commander` | 14 | CLI 框架 |
| `chokidar` | 5 | 文件监视 |
| `@lydell/node-pty` | — | 终端模拟 |

**开发依赖**：
| 包 | 版本 | 用途 |
|---|---|---|
| `tsdown` | 0.21 | 打包器（Rolldown 内核） |
| `oxlint` / `oxfmt` | — | Oxc 生态的 lint + 格式化 |
| `@typescript/native-preview` | 7.0.0-dev | 原生 TS 编译器（`tsgo`） |
| `vitest` | 4.1 | 测试框架 |
| `tsx` | — | TypeScript 执行器 |

## TypeScript 配置

> 源码：`tsconfig.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "es2023",
    "lib": ["DOM", "DOM.Iterable", "ES2023", "ScriptHost"],
    "noEmit": true,
    "paths": {
      "openclaw/extension-api": ["./src/extensionAPI.ts"],
      "openclaw/plugin-sdk": ["./src/plugin-sdk/index.ts"],
      "openclaw/plugin-sdk/*": ["./src/plugin-sdk/*.ts"],
      "openclaw/plugin-sdk/account-id": ["./src/plugin-sdk/account-id.ts"]
    }
  },
  "include": ["src/**/*", "ui/**/*", "extensions/**/*"]
}
```

关键设计决策：

- **`strict: true`**：全量严格模式
- **`module: "NodeNext"`**：完整 ESM 支持
- **`noEmit: true`**：TypeScript 只做类型检查，tsdown 处理输出
- **`paths` 别名**：让扩展可以像导入外部包一样导入 plugin-sdk（`import { ... } from "openclaw/plugin-sdk"`），开发时解析到源码路径

## Plugin SDK 公共 API

> 源码：`src/plugin-sdk/index.ts`

SDK 有意保持根入口"极小化"——重功能放在专用子路径上：

### 值导出（仅 4 个）

```typescript
// src/plugin-sdk/index.ts — 仅有的 4 个值导出

export { emptyPluginConfigSchema } from "...";     // 默认空 schema
export { registerContextEngine } from "...";        // 注册自定义上下文引擎
export { delegateCompactionToRuntime } from "...";  // 压缩委托辅助
export { onDiagnosticEvent } from "...";            // 诊断事件监听
```

### 类型导出（大量）

```typescript
// src/plugin-sdk/index.ts — 类型导出（节选）

// 通道插件契约
export type { ChannelPlugin, ChannelConfigSchema, ChannelCapabilities, ChannelGatewayContext };
// 设置流程
export type { ChannelSetupAdapter, ChannelSetupWizard };
// 通用插件契约
export type { OpenClawPluginApi, OpenClawPluginConfigSchema };
// LLM 提供者插件
export type { ProviderAuthContext, ProviderRuntimeModel };
// 运行时 API
export type { PluginRuntime, RuntimeLogger, SubagentRunParams };
// 配置
export type { OpenClawConfig };
// 钩子与回复
export type { HookEntry, ReplyPayload, WizardPrompter };
// 上下文引擎插件
export type { ContextEngine, ContextEngineFactory };
// 有状态绑定驱动
export type { StatefulBindingTargetDriver };
```

### 90+ 子路径导出

重功能分布在专用子路径上，按需导入避免加载无关代码：

```
openclaw/plugin-sdk          → 4 值导出 + 大量类型
openclaw/plugin-sdk/routing  → 路由工具
openclaw/plugin-sdk/runtime  → 运行时 API
openclaw/plugin-sdk/core     → definePluginEntry, defineChannelPlugin
openclaw/plugin-sdk/account-id → 账户 ID 工具
openclaw/plugin-sdk/...      → 更多
```

## 配置系统

### 配置 Schema

> 源码：`src/config/types.openclaw.ts` + `src/config/types.ts`

OpenClawConfig 分解为约 35 个子类型模块，主 `types.ts` 做桶式重导出：

```typescript
// src/config/types.openclaw.ts

export type OpenClawConfig = {
  meta?: { lastTouchedVersion?: string; lastTouchedAt?: string };
  auth?: AuthConfig;
  acp?: AcpConfig;
  env?: {
    shellEnv?: { enabled?: boolean; timeoutMs?: number };
    vars?: Record<string, string>;
  };
  wizard?: { lastRunAt?: string };
  diagnostics?: DiagnosticsConfig;
  logging?: LoggingConfig;
  cli?: CliConfig;
  update?: {
    channel?: "stable" | "beta" | "dev";
    checkOnStart?: boolean;
    auto?: { ... };
  };
  browser?: BrowserConfig;
  ui?: { seamColor?: string; assistant?: { name?: string; avatar?: string } };
  secrets?: SecretsConfig;
  skills?: SkillsConfig;
  plugins?: PluginsConfig;
  models?: ModelsConfig;
  nodeHost?: NodeHostConfig;
  agents?: AgentsConfig;
  tools?: ToolsConfig;
  bindings?: AgentBinding[];
  channels?: ChannelsConfig;
  memory?: MemoryConfig;
  mcp?: McpConfig;
  gateway?: GatewayConfig;
  hooks?: HooksConfig;
  // 更多: broadcast, audio, media, messages, commands,
  //       approvals, session, web, cron, discovery, canvasHost, talk
};
```

**验证**：使用 `@sinclair/typebox` 定义 Schema，`ajv` 做运行时验证，同时生成 TypeScript 类型和 JSON Schema。

### 配置层次

```
优先级（高→低）:
1. 环境变量 OPENCLAW_*
2. CLI 参数 --port, --verbose, --model, ...
3. 配置文件 ~/.openclaw/openclaw.json（JSON5 格式）
4. 插件默认值 extensions/*/openclaw.plugin.json
5. 代码默认值 src/config/config.ts
```

## 代码质量工具

### Oxlint + Oxfmt

OpenClaw 使用 Oxc 生态（Rust 实现）替代传统的 ESLint + Prettier：

```bash
pnpm check          # oxlint（类型感知） + 格式化检查
pnpm lint           # oxlint --type-aware
pnpm format         # oxfmt --write
pnpm format:check   # oxfmt --check
```

`pnpm check` 实际上是一个组合命令，包含 15+ 自定义边界 lint 脚本：
- 格式化检查
- `tsgo`（原生 TS 类型检查）
- 插件隔离检查
- 扩展边界检查
- 通道无关性检查

## 测试系统

### Vitest 配置

> 源码：`vitest.config.ts` + `vitest.unit.config.ts`

```
vitest.config.ts           # 基础配置
vitest.unit.config.ts      # 单元测试（继承基础配置）
vitest.e2e.config.ts       # E2E 测试
vitest.gateway.config.ts   # Gateway 测试
vitest.channels.config.ts  # 通道测试
vitest.extensions.config.ts # 扩展测试
vitest.live.config.ts      # Live 测试（需要真实 API Key）
```

#### 基础配置关键参数

```typescript
// vitest.config.ts 关键配置

{
  pool: "forks",         // 使用 forks（而非 threads/vmForks）
  workers: isCI
    ? isWindows ? 2 : 3  // CI 环境
    : Math.max(4, Math.min(16, cpuCount)),  // 本地

  testTimeout: 120_000,  // 120 秒
  hookTimeout: isWindows ? 180_000 : undefined,

  // 环境安全：防止跨测试污染
  unstubEnvs: true,
  unstubGlobals: true,

  // 覆盖率阈值
  coverage: {
    thresholds: {
      lines: 70,
      functions: 70,
      branches: 55,
      statements: 70,
    },
    include: ["./src/**/*.ts"],
    // 排除 extensions/apps/UI
  },

  // 测试范围
  include: [
    "src/**/*.test.ts",
    "extensions/**/*.test.ts",
    "test/**/*.test.ts",
  ],
  exclude: ["*.live.test.ts", "*.e2e.test.ts"],
}
```

#### 单元测试配置

```typescript
// vitest.unit.config.ts

// 继承基础配置，增加：
// - 从 vitest.unit-paths.mjs 加载精确的 include/exclude 模式
// - 支持 OPENCLAW_VITEST_INCLUDE_FILE 环境变量（JSON 文件列出 glob 模式）
// - 支持 OPENCLAW_VITEST_EXTRA_EXCLUDE_FILE 环境变量
// - 用于 CI 分片控制
```

### 测试命令

```bash
# 常规测试
pnpm test                    # node scripts/test-parallel.mjs（自定义并行运行器）
pnpm test:fast               # vitest run --config vitest.unit.config.ts

# 覆盖率
pnpm test:coverage           # vitest run --config vitest.unit.config.ts --coverage

# 精确测试
pnpm test -- src/gateway/boot.test.ts  # 单文件
pnpm test -- -t "test name"            # 按名称过滤

# 扩展测试
pnpm test:extension telegram     # 测试单个扩展
pnpm test:extension --list       # 列出可测试的扩展
pnpm test:contracts              # 跨插件契约测试

# Live 测试（需要真实 Key）
CLAWDBOT_LIVE_TEST=1 pnpm test:live
LIVE=1 pnpm test:live            # 包含 provider live

# 低内存模式
OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
```

### 测试文件约定

```
源文件: src/gateway/boot.ts
测试文件: src/gateway/boot.test.ts      # 共置
E2E: src/gateway/server.e2e.test.ts     # E2E 后缀
Live: src/agents/xai.live.test.ts       # Live 后缀（需要真实 API）
```

## CI/CD

### GitHub Actions CI 管线

> 源码：`.github/workflows/ci.yml`

**触发条件**：Push 到 `main`，所有 Pull Request。并发组取消进行中的运行。

**19 个 Job**，智能范围检测跳过不相关的 Job：

| Job | 用途 | Runner |
|---|---|---|
| `docs-scope` | 检测是否仅文档变更（跳过重量级 job） | Ubuntu 24.04 (Blacksmith 16vcpu) |
| `changed-scope` | 检测变更区域（node/macos/android/windows/python） | Ubuntu |
| `changed-extensions` | 检测逐扩展变更，定向测试 | Ubuntu |
| `build-artifacts` | 构建并缓存 dist 产物 | Ubuntu |
| `check` | 格式检查 + `tsgo` + 全部 lint 规则 + 边界检查 | Ubuntu |
| `check-additional` | 死代码分析(knip)、重复检查(jscpd)、LOC 限制 | Ubuntu |
| `build-smoke` | 完整构建 + 单例检查 + 启动内存检查 | Ubuntu |
| `checks` | 单元测试(`test:fast`) + 覆盖率 | Ubuntu |
| `extension-fast` | 逐扩展测试隔离 | Ubuntu |
| `release-check` | 发布就绪验证 | Ubuntu |
| `check-docs` | 文档格式化、lint、链接检查、i18n 词汇表 | Ubuntu |
| `skills-python` | Python 技能测试 | Ubuntu |
| `secrets` | 秘密扫描 | Ubuntu |
| `checks-windows` | Windows 特定测试 | Windows 2025 (Blacksmith 32vcpu) |
| `macos` | macOS 构建 + Swift 测试 | macos-latest |
| `ios` | iOS 构建 (xcodegen + xcodebuild) | macos-latest |
| `android` | Android 构建 + lint + 测试 (Gradle) | Ubuntu |

**关键模式——智能范围检测**：
```
docs-only PR → 跳过所有重量级 job
非 macOS 变更 → 跳过 macOS/iOS job
非 Android 变更 → 跳过 Android job
非 Windows 变更 → 跳过 Windows job
```

**Job 依赖图**：
```
docs-scope ──→ changed-scope ──→ checks
                              ──→ check
                              ──→ check-additional
                              ──→ build-smoke
                              ──→ skills-python
           ──→ changed-extensions ──→ extension-fast
           ──→ build-artifacts ──→ release-check
           ──→ check-docs
           ──→ changed-scope ──→ checks-windows
                              ──→ macos ──→ (需要 check 完成)
                              ──→ android
```

### 其他 Workflow

```
.github/workflows/
├── codeql.yml              # 代码安全扫描
├── docker-release.yml      # Docker 发布
├── openclaw-npm-release.yml  # npm 发布
├── plugin-npm-release.yml  # 插件 npm 发布
├── install-smoke.yml       # 安装冒烟测试
├── sandbox-common-smoke.yml # 沙箱冒烟测试
├── labeler.yml             # PR 自动标签
├── stale.yml               # 过期 Issue/PR 管理
└── auto-response.yml       # 自动回复
```

## Docker 支持

### 多阶段构建

> 源码：`Dockerfile`

**4 个阶段**的精心设计：

```dockerfile
# 阶段 1: ext-deps — 提取选定扩展的 package.json
# 通过 OPENCLAW_EXTENSIONS 构建参数控制启用哪些扩展
FROM node:24-bookworm AS ext-deps
# 提取 extensions/*/package.json（仅选定的）

# 阶段 2: build — 安装依赖 + 构建
FROM node:24-bookworm AS build
# 安装 Bun + pnpm
# pnpm install --frozen-lockfile
# pnpm build:docker（精简构建）
# pnpm ui:build

# 阶段 3: runtime-assets — 精简运行时资源
FROM build AS runtime-assets
# pnpm prune --prod（移除 devDependencies）
# 删除 .d.ts 和 .map 文件

# 阶段 4: runtime — 最小运行时镜像
FROM node:24-bookworm AS runtime
# 仅复制: dist/, node_modules(prod), extensions/, skills/, docs/
# 非 root 运行: node 用户
# 健康检查: http://127.0.0.1:18789/healthz
# 入口: node openclaw.mjs gateway --allow-unconfigured
```

**基础镜像选择**：
- 默认: `node:24-bookworm`
- 精简: `node:24-bookworm-slim`（通过 `--build-arg OPENCLAW_VARIANT=slim`）
- 镜像 SHA256 摘要锁定，确保可重现构建

**可选构建参数**：
- `OPENCLAW_INSTALL_BROWSER` — 安装 Playwright + Chromium
- `OPENCLAW_INSTALL_DOCKER_CLI` — 安装 Docker CLI（沙箱需要）
- `OPENCLAW_DOCKER_APT_PACKAGES` — 自定义系统包
- `OPENCLAW_EXTENSIONS` — 启用的扩展列表

## 扩展包约定

> 源码：`extensions/telegram/package.json`（典型示例）

```json
{
  "name": "@openclaw/telegram",
  "version": "2026.3.14",
  "private": true,
  "type": "module",
  "dependencies": {
    "@grammyjs/runner": "^2.0.3",
    "grammy": "^1.41.1"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "channel": {
      "id": "telegram",
      "label": "Telegram",
      "docsPath": "/channels/telegram",
      "blurb": "simplest way to get started...",
      "systemImage": "paperplane"
    },
    "bundle": {
      "stageRuntimeDependencies": true
    }
  }
}
```

**`openclaw` 字段约定**：
- `extensions` — 入口点文件列表（被 tsdown 自动发现）
- `setupEntry` — 设置向导入口
- `channel` — 通道元数据（id, label, 文档路径, UI 简介, 图标）
- `bundle` — 构建时标志（如将运行时依赖暂存到主 bundle）

所有扩展是 workspace 包，与根包锁步版本（`2026.3.14`）。

## 关键设计模式

### 1. 依赖注入 (createDefaultDeps)

```typescript
export function createDefaultDeps(): CliDeps {
  return {
    config: loadConfig(),
    runtime: defaultRuntime,
    logger: createLogger(),
  };
}

async function myCommand(deps: CliDeps) {
  const cfg = deps.config;
  // ...
}
```

### 2. 动态导入边界 (*.runtime.ts)

```typescript
// ❌ 同一模块混合使用
import { foo } from "./heavy-module.js";
const { bar } = await import("./heavy-module.js");

// ✅ 创建专门的运行时边界
// heavy-module.runtime.ts (re-exports)
export { foo, bar } from "./heavy-module.js";

// 使用方（延迟加载）
const { foo } = await import("./heavy-module.runtime.js");
```

### 3. 子系统日志

```typescript
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway");
const logCanvas = log.child("canvas");
const logChannels = log.child("channels");

log.info("Gateway started");
logCanvas.debug("Canvas host ready");
```

### 4. TypeBox Schema 驱动

```typescript
import { Type } from "@sinclair/typebox";

const ConnectParams = Type.Object({
  auth: Type.Optional(Type.Object({ token: Type.String() })),
  device: DeviceIdentity,
  role: Type.Union([Type.Literal("operator"), Type.Literal("node")])
});

// 自动生成:
// - JSON Schema（运行时验证）
// - TypeScript 类型（编译时类型安全）
// - Swift 模型（iOS/macOS 代码生成）
```

### 5. 进程全局 Symbol 单例

在 ContextEngine Registry 和 MemoryIndexManager 中都使用了这种模式：

```typescript
// 确保 tsdown 打包的多份 dist chunks 共享同一个全局状态
const STATE_KEY = Symbol.for("openclaw.someGlobalState");

function getState() {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: State };
  g[STATE_KEY] ??= { /* 初始状态 */ };
  return g[STATE_KEY];
}
```

### 6. 事件驱动架构

```typescript
// Gateway 内部事件系统
onAgentEvent(event);               // Agent 事件
onHeartbeatEvent(event);           // 心跳事件
onSessionLifecycleEvent(event);    // 会话生命周期
onSessionTranscriptUpdate(event);  // 转录更新
enqueueSystemEvent(event);         // 系统事件入队
```

## 项目演进历史

```
Warelay → Clawdbot → Moltbot → OpenClaw

名称变更反映了项目从个人项目到开源社区项目的演进。
packages/ 下的 clawdbot/ 和 moltbot/ 是遗留兼容包。
```
