# Mini-OpenClaw 🦞

一个简化版的 [OpenClaw](https://github.com/openclaw/openclaw) 实现，用于学习 AI Agent 平台的架构设计。

## 架构概览

```
┌───────────────────────────────────────────────────────┐
│                      用户交互层                        │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────┐   │
│  │ CLI 渠道  │  │ Web UI 渠道   │  │ 更多渠道...   │   │
│  └─────┬────┘  └───────┬───────┘  └──────┬───────┘   │
│        │               │                 │            │
│  ┌─────┴───────────────┴─────────────────┴─────┐      │
│  │           Gateway 网关 (WebSocket)           │      │
│  │  - 消息路由 / 格式校验 / 幂等键去重          │      │
│  │  - Wire Protocol: req / res / event          │      │
│  └─────────────────────┬───────────────────────┘      │
│                        │                              │
│  ┌─────────────────────┴───────────────────────┐      │
│  │              Agent 运行时 (核心)              │      │
│  │                                              │      │
│  │  步骤1: 会话解析 (Session Resolution)         │      │
│  │  步骤2: 上下文组装 (Context Assembly)         │      │
│  │  步骤3: 执行循环 (LLM + Tool Execution)      │      │
│  │  步骤4: 保存状态 (Save State)                │      │
│  └──┬──────────┬──────────┬──────────┬─────────┘      │
│     │          │          │          │                 │
│  ┌──┴──┐  ┌───┴───┐  ┌──┴───┐  ┌──┴──────────┐      │
│  │会话  │  │ 记忆  │  │提示词 │  │ 工具系统     │      │
│  │管理  │  │ 系统  │  │组装器 │  │ (内置+插件)  │      │
│  └─────┘  └───────┘  └──────┘  └─────────────┘      │
│                                                       │
│  ┌───────────────────────────────────────────┐        │
│  │            workspace/ 配置文件              │        │
│  │  AGENTS.md | SOUL.md | TOOLS.md | USER.md │        │
│  └───────────────────────────────────────────┘        │
└───────────────────────────────────────────────────────┘
```

## 对应 OpenClaw 的核心概念

| 本项目文件 | OpenClaw 概念 | 说明 |
|-----------|-------------|------|
| `gateway.js` | Gateway Control Plane | WebSocket 网关，消息路由中枢 |
| `agent.js` | Agent Runtime | AI 核心引擎，4 步对话处理流程 |
| `session.js` | Session Management | 会话解析、持久化、自动压缩 |
| `memory.js` | Memory System | 长期记忆存储与检索 |
| `prompt-builder.js` | System Prompt Architecture | 多源组合式提示词组装 |
| `tool-system.js` | Tool System | 工具注册、定义、执行 |
| `llm-provider.js` | Provider Plugin | LLM 调用接口（Mock + 真实 API） |
| `channel-adapter.js` | Channel Adapter | 渠道适配器（CLI + Web） |
| `plugin-loader.js` | Extension System | 插件自动发现与加载 |
| `workspace/` | Agent Workspace | 可编辑的配置文件，控制 Agent 行为 |
| `extensions/` | Plugin Directory | 插件目录，放入即生效 |
| `web-ui.html` | Web Control Interface | 浏览器聊天界面 |

## 快速开始

```bash
# 安装依赖
cd AI/mini-openclaw
npm install

# 启动（Mock 模式，无需 API Key）
npm start

# 或使用真实 LLM API
OPENCLAW_LLM=real OPENAI_API_KEY=sk-xxx npm start
```

启动后有两种交互方式：

1. **命令行**：直接在终端输入消息
2. **Web UI**：打开浏览器访问 http://127.0.0.1:18789

## 消息的完整生命周期

以 Web UI 为例，一条消息从发送到收到回复经历 6 个阶段：

```
阶段1: 消息接收   → Web UI 通过 WebSocket 发送消息到 Gateway
阶段2: 访问控制   → Gateway 检查幂等键，防止重复处理
阶段3: 上下文组装 → Agent 加载会话历史 + 搜索记忆 + 组装系统提示词
阶段4: 模型调用   → 将上下文发送给 LLM（Mock 或真实 API）
阶段5: 工具执行   → 如果 LLM 请求调用工具，执行工具并将结果回传
阶段6: 回复发送   → 通过 Gateway 将回复推送到 Web UI
```

## 可以尝试的交互

在 CLI 或 Web UI 中输入：

- `"现在几点"` → 触发 get_current_time 工具
- `"列出文件"` → 触发 list_files 工具
- `"读取文件 'package.json'"` → 触发 read_file 工具
- `"执行命令 'node -v'"` → 触发 run_shell 工具
- `"给小明打招呼"` → 触发插件工具 greeting
- `"你是谁"` → 了解 OpenClaw 架构

## 扩展插件

在 `extensions/` 目录下创建子目录，放入 `index.js`：

```javascript
module.exports = {
  name: 'my-plugin',
  description: '我的自定义插件',
  tools: [{
    name: 'my_tool',
    description: '工具描述',
    parameters: { type: 'object', properties: {} },
    execute: async (args) => '工具执行结果',
  }],
};
```

重启后自动加载。

## 自定义 Agent 行为

编辑 `workspace/` 目录下的文件即可改变 Agent 行为：

- `AGENTS.md` — 核心指令（能做什么、不能做什么）
- `SOUL.md` — 人格和语气风格
- `TOOLS.md` — 工具使用说明
- `USER.md` — 用户画像

修改后重启生效（OpenClaw 原版支持热加载）。

## 与 OpenClaw 原版的差异

| 特性 | OpenClaw | Mini-OpenClaw |
|------|---------|---------------|
| LLM 调用 | Claude/GPT/Gemini 等真实 API | Mock 模式 + 可选 OpenAI API |
| 渠道 | 16+ 平台 (WhatsApp/Telegram/...) | CLI + Web |
| 记忆 | 向量数据库 + 语义搜索 | JSON 文件 + 关键词匹配 |
| 会话压缩 | LLM 辅助摘要 | 简易关键词提取 |
| 工具 | 60+ 内置工具 | 4 个内置 + 插件 |
| Canvas/A2UI | 可视化交互界面 | 未实现 |
| 语音 | 语音唤醒 + TTS/STT | 未实现 |
| 多 Agent | 多实例路由 | 单 Agent |
| 定时任务 | Cron + Webhook | 未实现 |
