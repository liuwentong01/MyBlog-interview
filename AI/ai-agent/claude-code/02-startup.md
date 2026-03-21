# 02 - Claude Code 启动流程深度解析

> 基于 Claude Code v2.1.80 逆向分析。Claude Code 的启动流程从一个 Node.js CLI 脚本开始，经历参数解析、配置加载、预取并行化、权限初始化、MCP 连接等多个阶段，最终进入交互式 TUI 或 headless 模式。
>
> **注意**：本文中的函数名（如 `$E_`、`Hu8`、`Zs1` 等）来自 minified 代码的逆向分析，这些标识符会随版本变化而不同，仅用于说明代码结构，不是稳定的 API 名称。

---

## 一、启动流程总览（ASCII 流程图）

```
                        ┌──────────────────┐
                        │    cli.js 入口     │
                        │ #!/usr/bin/env node│
                        └────────┬─────────┘
                                 │
                                 v
                        ┌──────────────────┐
                        │    $E_() 顶层入口  │
                        │  try/catch 包裹    │
                        └────────┬─────────┘
                                 │
                        ┌────────v─────────┐
                        │   快速路径判断      │
                        │ --version?        │
                        │ --chrome-native?  │
                        │ bridge mode?      │
                        └────────┬─────────┘
                          不匹配 │
                                 v
                        ┌──────────────────┐
                        │  main() / KE_()   │
                        │  Commander.js 解析 │
                        └────────┬─────────┘
                                 │
                                 v
                        ┌──────────────────┐
                        │   _E_() run 函数   │
                        └────────┬─────────┘
                                 │
                                 v
                        ┌──────────────────┐
                        │    setup() 初始化  │
                        │                   │
                        │ ┌───────────────┐ │
                        │ │ AE_() 配置加载  │ │
                        │ │ Hu8() 预取启动  │ │
                        │ │ Zs1() 权限初始化│ │
                        │ │ MCP 服务器连接  │ │
                        │ │ 会话恢复检查    │ │
                        │ └───────────────┘ │
                        └────────┬─────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    v                         v
          ┌─────────────────┐      ┌──────────────────┐
          │  runHeadless()   │      │  $t6() 交互式 TUI │
          │  非交互模式       │      │  Ink + React 渲染  │
          │  (--print, -p)   │      │  完整终端 UI       │
          └─────────────────┘      └──────────────────┘
```

---

## 二、入口点链（Entry Point Chain）详解

### 2.1 cli.js — 一切的起点

```javascript
#!/usr/bin/env node
// 这是 esbuild 打包后的单文件产物
// 整个 Claude Code 的所有代码都在这一个文件中
// 约 15600 行 minified 代码，~197K tokens
```

**关键点：**
- `#!/usr/bin/env node` 是 Unix shebang 行，告诉操作系统用 `node` 来执行这个脚本
- 当你运行 `claude` 命令时，系统通过 `$PATH` 找到这个文件并用 Node.js 执行
- 全部代码被 esbuild 打包成单文件，没有外部 `require` 依赖（依赖全部内联）

### 2.2 $E_() — 顶层入口函数

```javascript
// 伪代码还原
async function $E_() {
  try {
    // 设置全局异常处理
    process.on('uncaughtException', handleFatalError);
    process.on('unhandledRejection', handleFatalError);

    // 快速路径：不需要完整初始化的命令
    if (process.argv.includes('--version')) {
      console.log(VERSION);
      process.exit(0);
    }

    if (process.argv.includes('--chrome-native-host')) {
      // Chrome Native Messaging 协议处理
      // 用于浏览器扩展与 Claude Code 通信
      return handleChromeNativeHost();
    }

    if (isBridgeMode()) {
      // Bridge 模式：作为子进程被其他程序调用
      // 通过 stdin/stdout 进行 JSON-RPC 通信
      return handleBridgeMode();
    }

    // 正常启动路径
    await main();
  } catch (error) {
    // 顶层兜底：确保任何未捕获的错误都能优雅退出
    handleFatalError(error);
    process.exit(1);
  }
}

// 立即调用
$E_();
```

**快速路径（Fast Path）的设计哲学：**

快速路径是一种常见的 CLI 设计模式——对于不需要完整初始化的命令（如 `--version`），尽早返回，避免执行后续昂贵的初始化逻辑。这能显著提升用户体验：

| 命令 | 走快速路径？ | 耗时 | 说明 |
|------|-------------|------|------|
| `claude --version` | 是 | <50ms | 直接输出版本号退出 |
| `claude --chrome-native-host` | 是 | <100ms | 进入 Chrome 通信模式 |
| `claude bridge` | 是 | <100ms | 进入 Bridge 子进程模式 |
| `claude "hello"` | 否 | ~1-3s | 需要完整初始化 |
| `claude` | 否 | ~1-3s | 交互模式，完整初始化 |

### 2.3 main() / KE_() — Commander.js 解析

```javascript
async function main() {
  const program = new Commander.Command();

  program
    .name('claude')
    .version(VERSION)
    .description('Claude Code - An AI assistant for your terminal')

    // 核心选项
    .option('-p, --print', '非交互模式，直接输出结果到 stdout')
    .option('--continue', '继续上一次会话')
    .option('--resume <sessionId>', '恢复指定会话')
    // 配置选项
    .option('--model <model>', '指定使用的模型')
    .option('--settings <path>', '指定配置文件路径')
    .option('--permission-mode <mode>', '权限模式: default / plan / bypassPermissions / auto')
    .option('--allowedTools <tools...>', '预授权工具列表')

    // MCP 选项
    .option('--mcp-config <path>', 'MCP 服务器配置文件路径')

    // 调试选项
    .option('--verbose', '输出详细日志')
    .option('--debug', '启用 debug 模式');

  program.parse(process.argv);
  const options = program.opts();

  // 将解析后的选项传递给 run 函数
  await _E_(options);
}
```

### 2.4 _E_() — 实际 Run 函数

```javascript
async function _E_(options) {
  // 1. 执行 setup 初始化
  const context = await setup(options);

  // 2. 根据模式分支
  if (options.print) {
    // Headless 模式：不启动 TUI，直接处理输入并输出结果
    await runHeadless(context, options);
  } else {
    // 交互式模式：启动完整的 Ink TUI
    await $t6(context, options);
  }
}
```

**两种运行模式对比：**

```
┌─────────────────────────────────────────────────────────────┐
│                     Headless 模式 (-p)                       │
│                                                              │
│  echo "explain this code" | claude -p                        │
│                                                              │
│  特点：                                                      │
│  - 从 stdin 或命令行参数获取输入                               │
│  - 直接将结果输出到 stdout                                    │
│  - 适合管道和脚本中使用                                       │
│  - 不渲染 TUI 界面                                           │
│  - 执行完毕后自动退出                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   交互式 TUI 模式 ($t6)                      │
│                                                              │
│  claude                                                      │
│                                                              │
│  特点：                                                      │
│  - 基于 Ink (React for CLI) 渲染终端界面                      │
│  - 支持多轮对话                                               │
│  - 实时显示工具调用、流式输出                                   │
│  - 支持 /commands 斜杠命令                                    │
│  - 支持权限审批交互                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、关键启动步骤详解

### 3.1 配置加载 AE_() — 多源配置合并

配置加载是启动过程中最复杂的环节之一。Claude Code 需要从多个来源收集配置，并按优先级合并。

```
配置加载顺序（优先级从高到低）：

  ┌─────────────────────────────────────────────┐
  │  1. 命令行参数 (最高优先级)                    │
  │     claude --model opus --verbose             │
  ├─────────────────────────────────────────────┤
  │  2. 环境变量                                  │
  │     CLAUDE_MODEL=opus                         │
  │     CLAUDE_CODE_SETTINGS_PATH=...             │
  ├─────────────────────────────────────────────┤
  │  3. --settings 指定的配置文件                  │
  │     claude --settings ./my-settings.json      │
  ├─────────────────────────────────────────────┤
  │  4. 项目级 settings.json                      │
  │     .claude/settings.json (项目根目录)         │
  ├─────────────────────────────────────────────┤
  │  5. 用户级 settings.json                      │
  │     ~/.claude/settings.json                   │
  ├─────────────────────────────────────────────┤
  │  6. CLAUDE.md 文件 (指令型配置)               │
  │     项目根的 CLAUDE.md → 父目录的 → 全局的     │
  ├─────────────────────────────────────────────┤
  │  7. 默认值 (最低优先级)                        │
  │     代码中硬编码的默认配置                      │
  └─────────────────────────────────────────────┘
```

```javascript
// 伪代码还原 AE_() 配置加载
async function AE_(options) {
  // 1. 加载默认配置
  let config = { ...DEFAULT_CONFIG };

  // 2. 加载全局配置 ~/.claude/settings.json
  const globalSettings = await readJSON(
    path.join(os.homedir(), '.claude', 'settings.json')
  );
  config = deepMerge(config, globalSettings);

  // 3. 加载项目配置 .claude/settings.json
  const projectRoot = await findProjectRoot(process.cwd());
  if (projectRoot) {
    const projectSettings = await readJSON(
      path.join(projectRoot, '.claude', 'settings.json')
    );
    config = deepMerge(config, projectSettings);
  }

  // 4. 加载 --settings 指定的文件
  if (options.settings) {
    const customSettings = await readJSON(options.settings);
    config = deepMerge(config, customSettings);
  }

  // 5. 加载 CLAUDE.md 指令
  //    CLAUDE.md 不是传统 JSON 配置，而是自然语言指令
  //    会被注入到 System Prompt 中
  config.claudeMd = await loadClaudeMd(projectRoot);

  // 6. 命令行参数覆盖
  if (options.model) config.model = options.model;
  if (options.verbose) config.verbose = true;
  // ... 更多参数

  return config;
}
```

**CLAUDE.md 的特殊性：**

CLAUDE.md 不同于传统的 JSON/YAML 配置文件。它是一个 Markdown 文件，内容是面向 AI 的自然语言指令，会被注入到 System Prompt 的 `<system-reminder>` 部分。加载顺序：

```
CLAUDE.md 加载链：

  ~/.claude/CLAUDE.md          (全局级)
       │
       v  合并
  /project-root/CLAUDE.md      (项目级)
       │
       v  合并
  /project-root/.claude/CLAUDE.md  (项目级，隐藏目录)
       │
       v  合并
  /cwd/CLAUDE.md               (当前目录级，如果不同于项目根)
```

### 3.2 预取启动 Hu8() — 并行预加载

这是 Claude Code 启动性能优化的核心设计。

```javascript
// 伪代码还原 Hu8() 预取
async function Hu8(config) {
  // 并行启动多个异步任务，不等待它们完成
  // 返回 Promise 句柄，后续需要时再 await

  const prefetchResults = {
    // 1. 系统上下文收集（git 信息、目录结构等）
    systemContext: collectSystemContext(),

    // 2. 认证状态检查（API Key 是否有效、额度等）
    authStatus: checkAuthStatus(config),

    // 3. 远程设置拉取（服务端下发的配置、特性开关等）
    remoteSettings: fetchRemoteSettings(config),

    // 4. 模型可用性检查
    modelAvailability: checkModelAvailability(config.model),
  };

  return prefetchResults;
}
```

**为什么要用"预取"模式？**

```
串行加载 (不推荐):
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 系统上下文 │──>│ 认证检查  │──>│ 远程设置  │──>│ 模型检查  │
│  200ms   │   │  300ms   │   │  400ms   │   │  100ms   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
总耗时: 200 + 300 + 400 + 100 = 1000ms


并行预取 (Claude Code 的做法):
┌──────────┐
│ 系统上下文 │─────────(200ms)─────────┐
├──────────┤                          │
│ 认证检查  │──────────(300ms)────────┤
├──────────┤                          ├──> 全部就绪
│ 远程设置  │────────────(400ms)──────┤
├──────────┤                          │
│ 模型检查  │──(100ms)────────────────┘
└──────────┘
总耗时: max(200, 300, 400, 100) = 400ms   (节省 60%)
```

这种设计的核心思想是 **"尽早启动，延迟等待"**：

1. **尽早启动**：在 `setup()` 函数的最开始就发起所有异步任务
2. **延迟等待**：只在真正需要结果的时候才 `await` 对应的 Promise
3. **互不阻塞**：各任务之间没有依赖关系，可以完全并行
4. **优雅降级**：即使某个预取任务失败，也不阻塞其他任务

```javascript
// 实际使用预取结果的位置
async function setup(options) {
  const config = await AE_(options);          // 配置加载（同步依赖，必须先完成）
  const prefetch = Hu8(config);               // 预取启动（不 await，立即返回）

  // ... 执行其他初始化工作（权限、MCP 等）...
  // 这些工作和预取任务并行执行

  // 在真正需要时才等待预取结果
  const systemContext = await prefetch.systemContext;    // 此时可能已经完成了
  const authStatus = await prefetch.authStatus;          // 此时可能已经完成了

  return { config, systemContext, authStatus, ... };
}
```

### 3.3 工具权限初始化 Zs1()

权限系统决定了 Claude Code 可以执行哪些操作。初始化时需要根据当前的 permission mode 构建权限上下文。

```javascript
// 伪代码还原 Zs1() 权限初始化
function Zs1(config) {
  const permissionMode = config.permissionMode || 'default';

  // 构建权限上下文
  const permissionContext = {
    mode: permissionMode,

    // 预授权的工具列表（来自 --allowedTools 或 settings.json）
    allowedTools: new Set(config.allowedTools || []),

    // 已拒绝的工具列表
    deniedTools: new Set(),

    // 每次使用都需要审批的工具
    requireApproval: new Set(),

    // 路径级别的权限控制
    pathPermissions: buildPathPermissions(config),
  };

  return permissionContext;
}
```

**三种权限模式：**

```
┌──────────────────────────────────────────────────────────────────┐
│  Permission Mode     │  行为                                     │
├──────────────────────┼───────────────────────────────────────────┤
│  default             │  危险操作需要用户逐次确认                   │
│                      │  读取操作自动通过                          │
│                      │  写入/执行操作弹出审批                     │
├──────────────────────┼───────────────────────────────────────────┤
│  auto                │  基于规则自动判断，安全操作自动放行          │
│                      │  仅高危操作（如 rm -rf）需确认              │
│                      │  适合信任度高的场景                        │
├──────────────────────┼───────────────────────────────────────────┤
│  plan                │  只允许只读操作（读文件/搜索等）             │
│                      │  写入和执行操作直接拒绝                     │
│                      │  适合分析/规划场景                         │
└──────────────────────┴───────────────────────────────────────────┘
```

### 3.4 MCP 服务器连接

MCP (Model Context Protocol) 是 Claude Code 扩展外部工具能力的协议。启动时需要连接配置中声明的 MCP 服务器。

```javascript
// 伪代码还原 MCP 连接流程
async function connectMCPServers(config) {
  const mcpConfig = config.mcpServers || {};
  const connections = {};

  for (const [serverName, serverConfig] of Object.entries(mcpConfig)) {
    try {
      // 每个 MCP 服务器作为子进程启动
      // 通过 stdio (stdin/stdout) 进行 JSON-RPC 通信
      const transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      });

      const client = new MCPClient();
      await client.connect(transport);

      // 获取服务器提供的工具列表
      const tools = await client.listTools();

      connections[serverName] = { client, tools };
    } catch (error) {
      // MCP 连接失败不应阻塞启动
      console.warn(`MCP server "${serverName}" failed to connect:`, error);
    }
  }

  return connections;
}
```

**MCP 服务器启动时序：**

```
Claude Code 进程
     │
     ├──> spawn("npx", ["-y", "@modelcontextprotocol/server-filesystem"])
     │         │
     │         ├── stdin ──> JSON-RPC 请求
     │         ├── stdout <── JSON-RPC 响应
     │         └── stderr ──> 日志输出
     │
     ├──> spawn("node", ["./my-mcp-server/dist/index.js"])
     │         │
     │         ├── stdin ──> JSON-RPC 请求
     │         └── stdout <── JSON-RPC 响应
     │
     └── ... 更多 MCP 服务器
```

### 3.5 会话恢复

Claude Code 支持多种方式恢复之前的会话，避免丢失上下文。

```javascript
// 伪代码还原会话恢复逻辑
async function restoreSession(options, config) {
  // 两种恢复方式，优先级从高到低

  if (options.resume) {
    // 1. --resume <sessionId>：恢复指定 ID 的会话
    //    会话数据存储在 ~/.claude/sessions/<id>/
    return await loadSession(options.resume);
  }

  if (options.continue) {
    // 3. --continue：继续最近一次会话
    //    查找 ~/.claude/sessions/ 下最新的会话
    const latestSession = await findLatestSession();
    if (latestSession) {
      return await loadSession(latestSession.id);
    }
  }

  // 无需恢复，创建新会话
  return createNewSession();
}
```

**会话数据结构：**

```
~/.claude/sessions/
├── abc123/
│   ├── messages.json       # 完整消息历史
│   ├── metadata.json       # 会话元数据（时间、模型、项目路径等）
│   └── context.json        # 上下文快照
├── def456/
│   ├── messages.json
│   ├── metadata.json
│   └── context.json
└── ...
```

---

## 四、setup() 完整初始化时序

将所有步骤串联起来，完整的 `setup()` 函数执行时序如下：

```
setup(options)
  │
  │  [STEP 1] 配置加载
  ├──> AE_(options)
  │      ├── 读取默认配置
  │      ├── 读取全局 settings.json
  │      ├── 读取项目 settings.json
  │      ├── 读取 --settings 自定义文件
  │      ├── 加载 CLAUDE.md 链
  │      └── 命令行参数覆盖
  │
  │  [STEP 2] 预取启动（并行，不阻塞）
  ├──> Hu8(config)  ──────────────────────┐
  │      ├── collectSystemContext()  ──>  │ (并行执行中...)
  │      ├── checkAuthStatus()      ──>  │
  │      ├── fetchRemoteSettings()  ──>  │
  │      └── checkModelAvailability()──> │
  │                                       │
  │  [STEP 3] 权限初始化（与预取并行）      │
  ├──> Zs1(config)                        │
  │      ├── 确定 permission mode          │
  │      ├── 构建 allowedTools 集合        │
  │      └── 构建路径权限                   │
  │                                       │
  │  [STEP 4] MCP 服务器连接（与预取并行）  │
  ├──> connectMCPServers(config)          │
  │      ├── 遍历 mcpServers 配置         │
  │      ├── spawn 子进程                  │
  │      ├── JSON-RPC 握手                │
  │      └── 获取工具列表                  │
  │                                       │
  │  [STEP 5] 会话恢复                    │
  ├──> restoreSession(options)            │
  │      ├── 检查 --resume                │
  │      └── 检查 --continue              │
  │                                       │
  │  [STEP 6] 等待预取结果 <──────────────┘
  ├──> await prefetch.systemContext
  ├──> await prefetch.authStatus
  ├──> await prefetch.remoteSettings
  │
  │  [STEP 7] 构建初始化上下文
  └──> return {
         config,
         systemContext,
         authStatus,
         permissionContext,
         mcpConnections,
         session,
       }
```

---

## 五、Commander.js 的作用与 CLI 框架对比

### 5.1 什么是 Commander.js

Commander.js 是 Node.js 生态中最流行的命令行参数解析库。它的核心职责是：

1. **定义 CLI 接口**：声明命令、选项、参数
2. **解析 process.argv**：将命令行字符串转换为结构化的 JavaScript 对象
3. **自动生成 --help**：根据声明自动生成帮助文档
4. **类型转换**：字符串参数自动转换为目标类型
5. **子命令支持**：支持 `claude config set key value` 这样的嵌套命令

```javascript
// Commander.js 解析 process.argv 的过程

// 输入：process.argv = ['node', 'claude', '-p', '--model', 'opus', 'fix the bug']
//
// Commander.js 解析后：
// {
//   print: true,           // -p 布尔选项
//   model: 'opus',         // --model 带值选项
//   args: ['fix the bug']  // 位置参数（用户输入的 prompt）
// }
```

### 5.2 常见 CLI 框架对比

```
┌───────────────────┬────────────────┬──────────────────┬────────────────┐
│      特性          │  Commander.js  │     yargs        │    minimist    │
├───────────────────┼────────────────┼──────────────────┼────────────────┤
│ GitHub Stars      │  ~27k          │  ~11k            │  ~5k           │
│ 包大小            │  ~50KB         │  ~200KB          │  ~5KB          │
│ 子命令支持        │  原生支持       │  原生支持         │  不支持        │
│ 自动 --help       │  支持          │  支持             │  不支持        │
│ 类型推断          │  支持          │  支持             │  基本支持      │
│ 链式 API         │  支持          │  支持             │  不支持        │
│ 适用场景          │  中大型 CLI    │  复杂 CLI         │  轻量脚本      │
│ 代表项目          │  Claude Code   │  webpack-cli     │  各种小工具    │
│                   │  Vue CLI       │  ESLint           │               │
└───────────────────┴────────────────┴──────────────────┴────────────────┘
```

**Claude Code 选择 Commander.js 的原因：**

- **轻量**：打包后体积小，适合单文件 bundle
- **成熟稳定**：10+ 年历史，npm 周下载量数千万
- **链式声明**：API 风格与 Claude Code 的代码风格一致
- **子命令**：支持 `claude config`, `claude mcp` 等子命令组织

### 5.3 Claude Code 的子命令结构

```
claude                          # 默认：交互式 TUI
claude "fix the bug"            # 带 prompt 的交互模式
claude -p "explain this"        # Headless 模式
claude --continue               # 继续上次会话

claude config                   # 配置管理子命令组
  ├── claude config list        # 列出当前配置
  ├── claude config set <k> <v> # 设置配置项
  └── claude config get <key>   # 获取配置项

claude mcp                      # MCP 管理子命令组
  ├── claude mcp list           # 列出 MCP 服务器
  ├── claude mcp add <name>     # 添加 MCP 服务器
  └── claude mcp remove <name>  # 移除 MCP 服务器
```

---

## 六、配置优先级深入解析

### 6.1 优先级规则

Claude Code 的配置合并遵循 **"越具体、越靠近用户的配置优先级越高"** 原则：

```
优先级从高到低：

[1] 命令行参数          claude --model opus
      │  覆盖
      v
[2] 环境变量            CLAUDE_MODEL=opus
      │  覆盖
      v
[3] --settings 文件     claude --settings ./custom.json
      │  覆盖
      v
[4] 项目级配置          .claude/settings.json
      │  覆盖
      v
[5] 用户级配置          ~/.claude/settings.json
      │  覆盖
      v
[6] 默认值              代码内硬编码
```

### 6.2 深度合并（Deep Merge）策略

配置合并不是简单的浅层覆盖，而是深度合并（deepMerge）：

```javascript
// 全局配置 (~/.claude/settings.json)
{
  "model": "sonnet",
  "permissions": {
    "allow": ["Read", "Glob", "Grep"],
    "deny": []
  },
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["..."] }
  }
}

// 项目配置 (.claude/settings.json)
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "Write", "Bash"]
  },
  "mcpServers": {
    "confluence": { "command": "node", "args": ["..."] }
  }
}

// 合并结果：
{
  "model": "sonnet",                          // 来自全局（项目未覆盖）
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "Write", "Bash"],  // 项目覆盖
    "deny": []                                             // 全局保留
  },
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["..."] },   // 全局保留
    "confluence": { "command": "node", "args": ["..."] }    // 项目新增
  }
}
```

### 6.3 CLAUDE.md 的合并策略

CLAUDE.md 文件的合并与 JSON 配置不同——它们是**拼接**而非覆盖：

```
最终注入到 System Prompt 中的内容：

<system-reminder>
# claudeMd
Contents of ~/.claude/CLAUDE.md (global instructions):
[全局级 CLAUDE.md 内容]

Contents of /project/CLAUDE.md (project instructions, checked into the codebase):
[项目级 CLAUDE.md 内容]

Contents of /project/.claude/CLAUDE.md (project instructions):
[项目隐藏目录级 CLAUDE.md 内容]
</system-reminder>
```

所有层级的 CLAUDE.md 都会被保留并拼接，每个文件都会标注来源路径，让 AI 能够区分不同层级的指令。

---

## 七、启动流程中的错误处理策略

Claude Code 的启动流程采用了 **"分级容错"** 策略——不同阶段的错误有不同的处理方式：

```
┌────────────────────┬─────────────────────────────────────────────┐
│    错误发生阶段     │              处理策略                        │
├────────────────────┼─────────────────────────────────────────────┤
│ 配置加载失败        │ 降级到默认配置，打印 warning                  │
│ 认证检查失败        │ 阻塞启动，引导用户登录                       │
│ 预取超时           │ 使用缓存值或跳过，不阻塞                     │
│ MCP 服务器连接失败  │ 跳过该服务器，其余继续，打印 warning          │
│ 会话恢复失败        │ 降级到新建会话，打印 warning                 │
│ 权限初始化失败      │ 降级到最严格模式（全部需要审批）              │
│ 终端初始化失败      │ 阻塞启动，无法恢复                          │
└────────────────────┴─────────────────────────────────────────────┘
```

核心原则：**只有"认证失败"和"终端初始化失败"会阻塞启动，其他环节都有降级方案**。这确保了用户在各种网络和环境条件下都能尽快进入可用状态。

---

## 八、总结：启动流程设计的工程智慧

Claude Code 的启动流程体现了几个重要的工程设计原则：

1. **快速路径优先**：对不需要完整初始化的命令（`--version`），尽早返回，提升响应速度
2. **并行化预取**：利用 JavaScript 的异步特性，将无依赖的 I/O 操作并行化，显著缩短启动时间
3. **分层配置合并**：遵循"越具体越优先"的原则，通过 deepMerge 实现灵活的配置覆盖
4. **优雅降级**：非关键路径的失败不阻塞启动，用合理的默认值兜底
5. **关注点分离**：配置加载、权限初始化、MCP 连接、会话恢复各自独立，互不耦合
6. **单文件分发**：esbuild 打包为单个 `cli.js`，简化安装和分发流程

这些设计使得 Claude Code 能在约 1-3 秒内完成从冷启动到可交互状态的全过程，同时保持了极高的灵活性和容错性。
