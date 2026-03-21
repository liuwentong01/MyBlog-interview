# 10 - 项目工程结构与开发实践

## Monorepo 管理

### pnpm Workspace

```yaml
# pnpm-workspace.yaml
packages:
  - .              # 根包（openclaw 核心）
  - ui             # Control UI
  - packages/*     # 遗留/兼容包
  - extensions/*   # 70+ 插件包
```

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

## 构建系统

### 构建流程

```bash
# 完整构建
pnpm build

# 构建使用 tsdown (基于 esbuild)
# 输出到 dist/

# UI 构建
pnpm ui:build   # Vite 构建 Control UI

# 类型检查
pnpm tsgo       # 使用 Go 实现的 tsc，极速
```

### tsdown 配置

```typescript
// tsdown.config.ts
export default {
  entry: ["src/index.ts"],
  outDir: "dist",
  format: "esm",
  // ... 更多配置
};
```

### TypeScript 配置

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "es2023",
    "strict": true,
    "experimentalDecorators": true,    // 用于 Lit
    "useDefineForClassFields": false,  // Lit legacy decorators
    "paths": {
      "openclaw/plugin-sdk": ["./src/plugin-sdk/index.ts"],
      "openclaw/plugin-sdk/*": ["./src/plugin-sdk/*.ts"]
    }
  }
}
```

## 代码质量工具

### Oxlint + Oxfmt

```bash
# Lint 检查
pnpm check          # oxlint

# 格式化检查
pnpm format          # oxfmt --check

# 格式化修复
pnpm format:fix      # oxfmt --write
```

配置文件：
- `.oxlintrc.json` — Lint 规则
- `.oxfmtrc.jsonc` — 格式化规则

### Pre-commit Hooks

```bash
prek install         # 安装 pre-commit hooks
# 运行与 CI 相同的检查
```

## 测试系统

### Vitest 配置

```
vitest.config.ts           # 默认配置
vitest.unit.config.ts      # 单元测试
vitest.e2e.config.ts       # E2E 测试
vitest.gateway.config.ts   # Gateway 测试
vitest.channels.config.ts  # 通道测试
vitest.extensions.config.ts # 扩展测试
vitest.live.config.ts      # Live 测试（需要真实 API Key）
```

### 测试命令

```bash
# 常规测试
pnpm test                        # 完整测试套件
pnpm test:coverage               # 带覆盖率

# 精确测试
pnpm test -- src/gateway/boot.test.ts  # 单文件
pnpm test -- -t "test name"            # 按名称过滤

# 扩展测试
pnpm test:extension telegram     # 测试单个扩展
pnpm test:extension --list       # 列出可测试的扩展
pnpm test:contracts              # 跨插件契约测试
pnpm test:contracts:channels     # 通道契约测试
pnpm test:contracts:plugins      # 插件契约测试

# Live 测试（需要真实 Key）
CLAWDBOT_LIVE_TEST=1 pnpm test:live         # OpenClaw live
LIVE=1 pnpm test:live                        # 包含 provider live

# Docker 测试
pnpm test:docker:live-models     # Docker 模型测试
pnpm test:docker:live-gateway    # Docker Gateway 测试
pnpm test:docker:onboard         # Docker onboarding E2E

# 低内存模式
OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
```

### 测试覆盖率

```
V8 coverage 阈值:
├── Lines: 70%
├── Branches: 70%
├── Functions: 70%
└── Statements: 70%
```

### 测试文件约定

```
源文件: src/gateway/boot.ts
测试文件: src/gateway/boot.test.ts      # 共置

E2E: src/gateway/server.e2e.test.ts     # E2E 后缀
```

## 配置系统

### 配置文件

```
~/.openclaw/openclaw.json    # 主配置文件（JSON5 格式）
~/.openclaw/models.json      # 模型提供者配置（可选覆盖）
```

### 配置层次

```
优先级（高→低）:

1. 环境变量
   OPENCLAW_*

2. CLI 参数
   --port, --verbose, --model, ...

3. 配置文件
   ~/.openclaw/openclaw.json

4. 插件默认值
   extensions/*/openclaw.plugin.json

5. 代码默认值
   src/config/config.ts 中的默认值
```

### 主要配置项

```json5
{
  // Agent 配置
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      model: { primary: "anthropic/claude-opus-4-6" },
      concurrency: 3,
      blockStreamingDefault: "off",
      compaction: { reserveTokensFloor: 20000 },
    },
    list: [/* 多 Agent 配置 */],
  },

  // 会话配置
  session: {
    dmScope: "main",
    reset: { mode: "daily", atHour: 4 },
    maintenance: { mode: "warn" },
  },

  // 通道配置
  channels: {
    whatsapp: { /* ... */ },
    telegram: { /* ... */ },
    discord: { /* ... */ },
  },

  // 路由绑定
  bindings: [/* ... */],

  // 工具配置
  tools: {
    browser: { enabled: true },
    exec: { approval: { required: true } },
  },

  // 插件配置
  plugins: {
    slots: { contextEngine: "legacy", memory: "memory-core" },
    entries: { /* per-plugin config */ },
  },

  // 模型配置
  models: {
    mode: "merge",
    providers: { /* 自定义提供者 */ },
  },

  // Gateway 配置
  gateway: {
    mode: "local",
    port: 18789,
    auth: { /* 认证配置 */ },
  },

  // Cron 配置
  cron: { jobs: [/* ... */] },

  // Webhook 配置
  webhooks: { endpoints: [/* ... */] },
}
```

## Docker 支持

### Dockerfile 层次

```
Dockerfile                  # 主 Gateway 镜像
Dockerfile.sandbox          # 沙箱基础镜像
Dockerfile.sandbox-browser  # 带浏览器的沙箱
Dockerfile.sandbox-common   # 通用沙箱基础

docker-compose.yml          # 组合部署
docker-setup.sh             # Docker 设置脚本
```

### 部署选项

```
1. 本地安装（推荐）
   npm install -g openclaw@latest
   openclaw onboard --install-daemon

2. Docker
   docker-compose up -d

3. Nix（声明式）
   nix run github:openclaw/nix-openclaw

4. Cloud（Fly.io / Render）
   fly.toml / render.yaml
```

## 版本管理

### 版本位置

```
package.json                              → CLI 版本
apps/android/app/build.gradle.kts         → Android (versionName/versionCode)
apps/ios/Sources/Info.plist               → iOS (CFBundleShortVersionString)
apps/ios/Tests/Info.plist                 → iOS Tests
apps/macos/.../Info.plist                 → macOS (CFBundleShortVersionString)
docs/install/updating.md                  → 文档中的固定版本
```

### 版本格式

```
CLI: YYYY.M.D (例: 2026.3.14)
稳定版: vYYYY.M.D
Beta: vYYYY.M.D-beta.N
补丁: vYYYY.M.D-patch
```

### 发布通道

```
stable → npm dist-tag: latest
beta   → npm dist-tag: beta
dev    → npm dist-tag: dev (从 main 分支发布时)
```

## CI/CD

### GitHub Actions

```
.github/workflows/
├── ci.yml                  # 主 CI（lint + test + build）
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

### CI 关键检查

```
pnpm check    → Lint + 格式化
pnpm build    → TypeScript 构建
pnpm test     → Vitest 完整测试套件
```

## 关键设计模式

### 1. 依赖注入 (createDefaultDeps)

```typescript
// src/cli/deps.ts
export function createDefaultDeps(): CliDeps {
  return {
    config: loadConfig(),
    runtime: defaultRuntime,
    logger: createLogger(),
    // ... 更多依赖
  };
}

// 使用
async function myCommand(deps: CliDeps) {
  const cfg = deps.config;
  // ...
}
```

### 2. 动态导入边界 (*.runtime.ts)

```typescript
// 不要混合使用静态和动态导入
// ❌ 同一模块同时使用两种导入
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

// 定义 schema
const ConnectParams = Type.Object({
  auth: Type.Optional(Type.Object({
    token: Type.String()
  })),
  device: DeviceIdentity,
  role: Type.Union([
    Type.Literal("operator"),
    Type.Literal("node")
  ])
});

// 自动生成:
// - JSON Schema（用于运行时验证）
// - TypeScript 类型（编译时类型安全）
// - Swift 模型（iOS/macOS 代码生成）
```

### 5. 事件驱动架构

```typescript
// Gateway 内部事件系统
onAgentEvent(event);           // Agent 事件
onHeartbeatEvent(event);       // 心跳事件
onSessionLifecycleEvent(event); // 会话生命周期
onSessionTranscriptUpdate(event); // 转录更新
enqueueSystemEvent(event);     // 系统事件入队
```

## 项目演进历史

```
Warelay → Clawdbot → Moltbot → OpenClaw

名称变更反映了项目从个人项目到开源社区项目的演进。
packages/ 下的 clawdbot/ 和 moltbot/ 是遗留兼容包。
```
