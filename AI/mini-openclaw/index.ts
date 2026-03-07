/**
 * index.js - Mini-OpenClaw 启动入口
 *
 * 这个文件负责组装和启动整个 Mini-OpenClaw 系统。
 * 它是理解整个架构的最佳起点——通过观察各组件如何被创建和连接，
 * 可以一目了然地看到 OpenClaw 的全局架构。
 *
 * ===== 启动流程图 =====
 *
 *  ┌─────────────┐   ┌──────────────┐
 *  │ ToolSystem  │   │ PluginLoader │
 *  │ (内置工具)   │◄──│ (扫描插件)    │
 *  └──────┬──────┘   └──────────────┘
 *         │
 *         │  ┌──────────────┐   ┌────────────────┐
 *         │  │ MemorySystem │◄──│ SessionManager │
 *         │  │ (长期记忆)    │   │ (会话+压缩)     │
 *         │  └──────┬───────┘   └───────┬────────┘
 *         │         │                   │
 *         │  ┌──────┴───────┐   ┌───────┴────────┐
 *         │  │ PromptBuilder│   │  LLMProvider   │
 *         │  │ (提示词组装)  │   │  (Mock/真实API) │
 *         │  └──────┬───────┘   └───────┬────────┘
 *         │         │                   │
 *         ▼         ▼                   ▼
 *  ┌─────────────────────────────────────────────┐
 *  │          Agent (核心引擎，依赖注入)           │
 *  │  接收所有依赖，执行 4 步对话处理流程          │
 *  └────────────────────┬────────────────────────┘
 *                       │ 注入
 *                       ▼
 *  ┌─────────────────────────────────────────────┐
 *  │        Gateway (网关，消息唯一入口)           │
 *  │  订阅 Agent 事件，路由结果到对应渠道          │
 *  └───────┬─────────────────────────┬───────────┘
 *          │ 注册                     │ 注册
 *          ▼                         ▼
 *  ┌──────────────┐          ┌──────────────┐
 *  │  CLIChannel  │          │  WebChannel  │
 *  │  (命令行)     │          │  (浏览器)     │
 *  └──────────────┘          └──────────────┘
 *
 * ===== 消息流转图（所有渠道统一路径） =====
 *
 *  用户输入
 *    │
 *    ▼
 *  Channel Adapter ──parseIncoming()──► 统一消息格式
 *    │
 *    ▼
 *  Gateway.submitMessage()
 *    ├── checkAccess()  ──► 访问控制（白名单/配对/群聊策略）
 *    ├── 幂等键检查     ──► 命中缓存则直接返回
 *    └── 注册 pending   ──► _pendingMessages[messageId]
 *          │
 *          ▼  异步分发（fire-and-forget）
 *  Agent.processMessage()
 *    ├── 步骤1: 会话解析    → resolveSessionId()
 *    ├── 步骤2: 上下文组装  → 历史 + 记忆 + 系统提示词 + 工具定义
 *    ├── 步骤3: 执行循环    → LLM ⇄ Tool（最多 5 轮）
 *    └── 步骤4: 保存状态    → 会话持久化 + 记忆提取
 *          │
 *          ▼  emit('agent:response')
 *  Gateway 事件路由
 *    │  通过 messageId 查找 pending → 调用 callbacks
 *    ▼
 *  Channel Adapter ──formatOutgoing()──► 用户看到回复
 *
 * 关键点：CLI 和 Web 走的是完全相同的路径，都经过 Gateway。
 */

import ToolSystem from "./tool-system";
import PluginLoader from "./plugin-loader";
import SessionManager from "./session";
import MemorySystem from "./memory";
import PromptBuilder from "./prompt-builder";
import { createLLMProvider } from "./llm-provider";
import Agent from "./agent";
import { CLIChannel, WebChannel } from "./channel-adapter";
import Gateway from "./gateway";
import type { SubmitCallbacks } from "./types";

async function main() {
  console.log("=".repeat(50));
  console.log("  🦞 Mini-OpenClaw — 简易 AI Agent 平台");
  console.log("  用于学习 OpenClaw 的架构设计原理");
  console.log("=".repeat(50));
  console.log();

  // ========== 1. 初始化工具系统 ==========
  const toolSystem = new ToolSystem();
  console.log(`[启动] 工具系统已初始化，内置工具: ${toolSystem.getToolNames().join(", ")}`);

  // ========== 2. 加载插件 ==========
  const pluginLoader = new PluginLoader(toolSystem);
  pluginLoader.loadPlugins();

  // ========== 3. 初始化记忆系统 ==========
  // 记忆系统需要在 SessionManager 之前创建，
  // 因为 SessionManager 需要引用 memory（用于压缩前的 Memory Flush）
  const memory = new MemorySystem();
  console.log(`[启动] 记忆系统已初始化，已有 ${memory.getAll().length} 条记忆`);

  // ========== 4. 初始化会话管理器 ==========
  // 注入 memory 引用，这样 Session 压缩时可以调用 memory.extractFromMessages()
  // 实现 OpenClaw 的 "pre-compaction memory flush" 机制
  const sessionManager = new SessionManager({
    maxHistoryLength: 30,
    keepRecentCount: 10,
    memory,
  });
  console.log("[启动] 会话管理器已初始化（已连接记忆系统）");

  // ========== 5. 初始化提示词组装器 ==========
  // PromptBuilder 每轮对话都从磁盘重新读取 workspace 文件（支持热更新）
  const promptBuilder = new PromptBuilder();
  console.log("[启动] 提示词组装器已初始化");

  // ========== 6. 创建 LLM 提供商 ==========
  // 默认 Mock 模式（无需 API Key）；设置 OPENCLAW_LLM=real 可切换到真实 API
  const llmProvider = createLLMProvider({ type: process.env.OPENCLAW_LLM });

  // ========== 7. 创建 Agent ==========
  // Agent 是核心引擎，通过依赖注入整合所有模块
  // Agent 继承 EventEmitter，处理过程中发射事件（事件驱动设计）
  const agent = new Agent({
    sessionManager,
    memory,
    promptBuilder,
    toolSystem,
    llmProvider,
  });

  // ========== 8. 创建 Gateway ==========
  // Gateway 是消息的唯一入口，所有渠道的消息都通过 Gateway.submitMessage() 处理
  // Gateway 订阅 Agent 事件，将结果路由回对应的渠道连接
  const PORT = parseInt(process.env.OPENCLAW_PORT || "3003", 10);
  const gateway = new Gateway({
    port: PORT,
    host: process.env.OPENCLAW_HOST || "127.0.0.1",
    agent,
  });

  // ========== 9. 创建并注册渠道 ==========
  const cliChannel = new CLIChannel();
  const webChannel = new WebChannel();

  // 所有渠道必须注册到 Gateway，这样 Gateway 才能：
  //   a. 调用 channel.parseIncoming() 解析消息
  //   b. 调用 channel.checkAccess() 检查访问权限
  gateway.registerChannel("cli", cliChannel);
  gateway.registerChannel("web", webChannel);

  // ========== 10. 连接 CLI 渠道到 Gateway ==========
  //
  // 关键设计：CLI 的消息也通过 Gateway.submitMessage() 统一入口处理！
  // 这确保 CLI 消息和 Web 消息走完全相同的流程：
  //   消息解析 → 访问控制 → 幂等键检查 → Agent 分发 → 事件路由
  //
  // callbacks 是事件驱动的回调机制：
  //   - onEvent:    Agent 中间事件（如 tool_call）→ 可选择展示给用户
  //   - onResponse: Agent 最终回复 → 格式化输出到终端
  //   - onError:    处理出错 → 显示错误信息
  cliChannel.on("message", (rawText) => {
    console.log(`\n[CLI → Gateway] 收到消息: "${rawText}"`);

    const callbacks: SubmitCallbacks = {
      onEvent: (type, payload) => {
        // 中间事件：工具调用时实时展示
        if (type === "tool_call") {
          console.log(`  🔧 正在调用工具: ${payload.toolName}`);
        }
      },
      onResponse: (response) => {
        // 最终回复：通过 CLI 渠道格式化输出
        cliChannel.formatOutgoing(response);
        cliChannel.onResponseSent();
      },
      onError: (err) => {
        console.error(`  ❌ 错误: ${err.message}`);
        cliChannel.onResponseSent();
      },
    };

    gateway.submitMessage("cli", rawText, callbacks);
  });

  // ========== 启动服务 ==========
  gateway.start();
  webChannel.start();
  cliChannel.start();

  // ========== 优雅退出 ==========
  process.on("SIGINT", () => {
    console.log("\n[系统] 正在关闭...");
    gateway.stop();
    cliChannel.stop();
    webChannel.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    gateway.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
