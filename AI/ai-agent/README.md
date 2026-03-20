# Claude Code 架构深度分析

基于 Claude Code v2.1.80 的逆向分析学习笔记，深入剖析其作为 CLI Agent 系统的架构设计。

## 目录结构

| 文件 | 内容 |
|------|------|
| [01-overview.md](./01-overview.md) | 总体架构概览与设计理念 |
| [02-startup.md](./02-startup.md) | 入口与启动流程 |
| [03-agentic-loop.md](./03-agentic-loop.md) | Agentic Loop 核心消息循环 |
| [04-tool-system.md](./04-tool-system.md) | 工具系统详解 |
| [05-permission-system.md](./05-permission-system.md) | 权限系统 |
| [06-system-prompt.md](./06-system-prompt.md) | System Prompt 分层构建 |
| [07-ui-layer.md](./07-ui-layer.md) | UI 层与终端渲染 |
| [08-session-management.md](./08-session-management.md) | 会话管理与上下文压缩 |
| [09-mcp-integration.md](./09-mcp-integration.md) | MCP 协议集成 |
| [10-agent-subsystem.md](./10-agent-subsystem.md) | Agent 子系统 |
| [11-plugin-and-hooks.md](./11-plugin-and-hooks.md) | 插件系统与 Hooks |
| [12-tech-stack.md](./12-tech-stack.md) | 技术栈总结与数据流 |

## 分析基础

- 版本：Claude Code v2.1.80
- 代码量：~15600 行 minified 代码，约 197K tokens
- 构建产物：单文件 bundle (cli.js)，由 Bun bundler 打包

## 核心设计模式

Claude Code 的本质是一个 **Agent Loop** 系统，而非简单的 LLM Wrapper：

```
用户输入 → CLI 解析 → 会话管理 → Agentic Loop → LLM API → Tool 执行 → 结果返回
                                       ↑                              |
                                       └──── tool_result 反馈 ────────┘
```

这意味着 LLM 不仅仅是"回答问题"，而是作为一个**决策引擎**，在循环中不断评估当前状态、选择合适的工具、执行操作，直到认为任务完成。
