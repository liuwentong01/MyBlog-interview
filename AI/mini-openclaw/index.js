/**
 * index.js - Mini-OpenClaw 启动入口
 *
 * 这个文件负责组装和启动整个 Mini-OpenClaw 系统。
 *
 * OpenClaw 的启动流程：
 * 1. 初始化工具系统 (ToolSystem) → 注册内置工具
 * 2. 加载插件 (PluginLoader) → 扫描 extensions/ 目录，注册插件工具
 * 3. 初始化会话管理器 (SessionManager)
 * 4. 初始化记忆系统 (MemorySystem)
 * 5. 初始化提示词组装器 (PromptBuilder)
 * 6. 创建 LLM 提供商 (LLMProvider)
 * 7. 创建 Agent (核心引擎)
 * 8. 创建渠道适配器 (Channel Adapters)
 * 9. 启动网关 (Gateway) → HTTP + WebSocket 服务
 * 10. 启动 CLI 渠道 → 命令行交互
 *
 * 消息流转：
 *   用户 → Channel Adapter → Gateway → Agent → [LLM + Tools] → Gateway → Channel → 用户
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
  // ToolSystem 管理所有可用工具（内置 + 插件），供 Agent 调用
  const toolSystem = new ToolSystem();
  console.log(`[启动] 工具系统已初始化，内置工具: ${toolSystem.getToolNames().join(', ')}`);

  // ========== 2. 加载插件 ==========
  // 扫描 extensions/ 目录，自动发现和加载插件
  const pluginLoader = new PluginLoader(toolSystem);
  pluginLoader.loadAll();

  // ========== 3. 初始化会话管理器 ==========
  const sessionManager = new SessionManager({
    maxHistoryLength: 30,
    keepRecentCount: 10,
  });
  console.log('[启动] 会话管理器已初始化');

  // ========== 4. 初始化记忆系统 ==========
  const memory = new MemorySystem();
  console.log(`[启动] 记忆系统已初始化，已有 ${memory.getAll().length} 条记忆`);

  // ========== 5. 初始化提示词组装器 ==========
  const promptBuilder = new PromptBuilder();
  console.log('[启动] 提示词组装器已初始化');

  // ========== 6. 创建 LLM 提供商 ==========
  // 默认使用 Mock 模式（无需 API Key）
  // 设置 OPENCLAW_LLM=real 和 OPENAI_API_KEY 可切换到真实 API
  const llmProvider = createLLMProvider();

  // ========== 7. 创建 Agent ==========
  // Agent 是核心引擎，整合所有组件，执行对话和工具调用
  const agent = new Agent({
    sessionManager,
    memory,
    promptBuilder,
    toolSystem,
    llmProvider,
  });

  // 监听 Agent 事件
  agent.on('tool_call', ({ toolName, arguments: args, round }) => {
    console.log(`[Agent事件] 工具调用 (第${round}轮): ${toolName}`);
  });

  // ========== 8. 创建渠道适配器 ==========
  const cliChannel = new CLIChannel();
  const webChannel = new WebChannel();

  // ========== 9. 启动网关 ==========
  const gateway = new Gateway({
    port: parseInt(process.env.OPENCLAW_PORT || '18789', 10),
    host: process.env.OPENCLAW_HOST || '127.0.0.1',
    agent,
    webChannel,
  });
  gateway.start();

  // ========== 10. 连接 CLI 渠道到 Agent ==========
  // CLI 渠道的消息直接发给 Agent（不经过 Gateway 的 WebSocket）
  // 这展示了 OpenClaw 中渠道可以直接连接 Agent 的设计
  cliChannel.on('message', async (message) => {
    console.log(`\n[CLI] 收到消息: "${message.text}"`);
    const response = await agent.processMessage(message);
    cliChannel.formatOutgoing(response);
    cliChannel.onResponseSent();
  });

  // 启动 CLI 和 Web 渠道
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

// 启动
main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
