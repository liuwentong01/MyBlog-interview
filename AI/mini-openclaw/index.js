/**
 * index.js - Mini-OpenClaw 启动入口
 *
 * 这个文件负责组装和启动整个 Mini-OpenClaw 系统。
 * 它是理解整个架构的最佳起点——通过观察各组件如何被创建和连接，
 * 可以一目了然地看到 OpenClaw 的全局架构。
 *
 * ===== OpenClaw 启动流程 =====
 *
 * 1. 初始化工具系统 (ToolSystem)   → 注册内置工具
 * 2. 加载插件 (PluginLoader)       → 扫描 extensions/ 目录，注册插件工具
 * 3. 初始化记忆系统 (MemorySystem) → 长期记忆存储和检索
 * 4. 初始化会话管理器 (SessionManager) → 注入 memory 引用（用于压缩前的 Memory Flush）
 * 5. 初始化提示词组装器 (PromptBuilder)
 * 6. 创建 LLM 提供商 (LLMProvider)
 * 7. 创建 Agent (核心引擎)         → 注入所有依赖
 * 8. 创建 Gateway (网关)           → 注入 Agent，订阅其事件
 * 9. 创建渠道适配器 (Channels)     → 注册到 Gateway
 * 10. 连接渠道到 Gateway           → CLI 和 Web 都通过 Gateway 统一入口
 *
 * ===== 消息流转（所有渠道统一路径） =====
 *
 *   用户 → Channel Adapter → Gateway.submitMessage()
 *     → 访问控制 → 幂等键检查 → Agent.processMessage()
 *       → [会话解析 → 上下文组装 → LLM + Tools 执行循环 → 保存状态]
 *       → Agent 发射事件 (agent:response)
 *     → Gateway 路由事件到对应渠道
 *   → Channel Adapter → 用户
 *
 * 关键点：CLI 和 Web 走的是完全相同的路径，都经过 Gateway。
 */

const ToolSystem = require('./tool-system');
const PluginLoader = require('./plugin-loader');
const SessionManager = require('./session');
const MemorySystem = require('./memory');
const PromptBuilder = require('./prompt-builder');
const { createLLMProvider } = require('./llm-provider');
const Agent = require('./agent');
const Gateway = require('./gateway');
const { CLIChannel, WebChannel } = require('./channel-adapter');

async function main() {
  console.log('='.repeat(50));
  console.log('  🦞 Mini-OpenClaw — 简易 AI Agent 平台');
  console.log('  用于学习 OpenClaw 的架构设计原理');
  console.log('='.repeat(50));
  console.log();

  // ========== 1. 初始化工具系统 ==========
  const toolSystem = new ToolSystem();
  console.log(`[启动] 工具系统已初始化，内置工具: ${toolSystem.getToolNames().join(', ')}`);

  // ========== 2. 加载插件 ==========
  const pluginLoader = new PluginLoader(toolSystem);
  pluginLoader.loadAll();

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
  console.log('[启动] 会话管理器已初始化（已连接记忆系统）');

  // ========== 5. 初始化提示词组装器 ==========
  // PromptBuilder 每轮对话都从磁盘重新读取 workspace 文件（支持热更新）
  const promptBuilder = new PromptBuilder();
  console.log('[启动] 提示词组装器已初始化');

  // ========== 6. 创建 LLM 提供商 ==========
  // 默认 Mock 模式（无需 API Key）；设置 OPENCLAW_LLM=real 可切换到真实 API
  const llmProvider = createLLMProvider();

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
  const gateway = new Gateway({
    port: parseInt(process.env.OPENCLAW_PORT || '18789', 10),
    host: process.env.OPENCLAW_HOST || '127.0.0.1',
    agent,
  });

  // ========== 9. 创建并注册渠道 ==========
  const cliChannel = new CLIChannel();
  const webChannel = new WebChannel();

  // 所有渠道必须注册到 Gateway，这样 Gateway 才能：
  //   a. 调用 channel.parseIncoming() 解析消息
  //   b. 调用 channel.checkAccess() 检查访问权限
  gateway.registerChannel('cli', cliChannel);
  gateway.registerChannel('web', webChannel);

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
  cliChannel.on('message', (rawText) => {
    console.log(`\n[CLI → Gateway] 收到消息: "${rawText}"`);

    gateway.submitMessage('cli', rawText, {
      onEvent: (type, payload) => {
        // 中间事件：工具调用时实时展示
        if (type === 'tool_call') {
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
    });
  });

  // ========== 启动服务 ==========
  gateway.start();
  webChannel.start();
  cliChannel.start();

  // ========== 优雅退出 ==========
  process.on('SIGINT', () => {
    console.log('\n[系统] 正在关闭...');
    gateway.stop();
    cliChannel.stop();
    webChannel.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    gateway.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
