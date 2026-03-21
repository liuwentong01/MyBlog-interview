# 07 - 工具与能力系统

## 概述

OpenClaw 提供了丰富的工具系统，让 Agent 能够与外部世界交互。工具分为**内置工具**、**Skills**、**插件工具**和 **Node 能力**四大类。工具权限通过 per-agent 策略控制，高风险操作需要人在回路（Human-in-the-loop）审批。

## 工具体系结构

```
┌──────────────────────────────────────────────────────────────┐
│                       Tool System                             │
│                                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  内置工具       │  │  Plugin Tools  │  │   Skills       │ │
│  │ (Core Tools)   │  │ (插件注册)      │  │ (可组合技能)   │ │
│  │                │  │                │  │                │ │
│  │ read/write/edit│  │ browser (CDP)  │  │ bundled/       │ │
│  │ exec           │  │ canvas.*       │  │ managed/       │ │
│  │ apply_patch    │  │ firecrawl      │  │ workspace/     │ │
│  │ message/notify │  │ tavily         │  │                │ │
│  │ sessions_*     │  │ brave_search   │  │ SKILL.md       │ │
│  │ memory_*       │  │ elevenlabs     │  │ + 触发器       │ │
│  │ cron_*         │  │ open_prose     │  │                │ │
│  │ session_status │  │ ...            │  │                │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Node Capabilities (设备能力，通过 WebSocket 远程调用)  │  │
│  │                                                         │  │
│  │  camera.snap/clip │ screen.record │ location.get        │  │
│  │  canvas.push/eval/snapshot │ system.notify/run          │  │
│  │  contacts.* │ calendar.* │ photos.* │ motion.*          │  │
│  │  sms.* (Android) │ calllog.* (Android)                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 插件工具注册

插件通过 SDK 注册工具，使用工厂模式按上下文动态创建：

```typescript
// Plugin SDK 工具注册类型
type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;          // 每次 /new 和 /reset 重新生成
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;  // 受信任的发送者 ID（运行时提供）
  senderIsOwner?: boolean;     // 是否为 owner
  sandboxed?: boolean;
};

// 工厂函数：根据上下文动态返回工具
type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

// 注册示例
api.registerTool({
  name: "brave_search",
  factory: (ctx) => {
    if (!ctx.config?.tools?.braveSearch?.enabled) return null;
    return createBraveSearchTool(ctx.config.tools.braveSearch.apiKey);
  }
});
```

## 内置工具详解

### 文件操作工具

```
read:
  ├── 读取文件内容
  ├── 支持行范围读取
  ├── 支持图片/PDF 读取（多模态）
  └── 参数: path, lineRange?

write:
  ├── 写入/覆盖文件
  ├── 创建新文件
  └── 参数: path, content

edit:
  ├── 编辑已有文件（基于 diff 的精确修改）
  ├── 比全量 write 更安全
  └── 参数: path, oldContent, newContent

apply_patch:
  ├── 应用 unified diff 补丁
  ├── 可选功能，需配置开启
  └── 配置: tools.exec.applyPatch = true

exec:
  ├── 执行 shell 命令
  ├── 受沙箱和工具策略控制
  ├── 可配置超时
  ├── 高风险操作需要审批
  └── 参数: command, timeout?, cwd?
```

### 消息工具

```
message:
  ├── 向指定通道发送消息
  ├── action: "send"
  ├── 指定 channel + target
  ├── 支持附件
  └── 消息工具发送会被追踪，避免 assistant 确认文本重复

notify:
  ├── 系统通知
  └── 通过 Node 设备推送
```

### 会话工具

```
sessions_list:     列出所有活跃会话
sessions_history:  查看指定会话的历史消息
sessions_send:     向指定会话发送消息（跨会话通信）
sessions_spawn:    创建子 Agent 会话（独立模型、工具、工作空间）
session_status:    当前会话状态 + token 使用情况 + 当前时间戳
                   （Agent 需要当前时间时应使用此工具）
```

### 记忆工具

```
memory_search:
  ├── 语义搜索记忆库
  ├── 支持向量搜索 + BM25 混合搜索
  ├── 跨 MEMORY.md 和 memory/*.md 搜索
  └── 参数: query

memory_get:
  ├── 精确读取记忆文件
  ├── 支持行范围
  └── 文件不存在时优雅降级（返回空文本）
```

## Browser 工具

### 架构

```
src/browser/
├── 浏览器控制服务器
├── CDP (Chrome DevTools Protocol) 客户端
├── 页面快照（DOM 可访问性树 + 截图）
├── 动作执行器
└── 配置管理

工作流程:
1. Gateway 启动时创建独立的 Chrome/Chromium 实例
2. Agent 通过 browser 工具发送命令
3. 浏览器通过 CDP 执行操作（导航、点击、输入...）
4. 返回页面快照（可访问性树或截图）给 Agent

关键能力:
├── 导航到 URL
├── 截图（全页/区域）
├── DOM 快照（可访问性树 — 无需视觉模型即可理解页面结构）
├── 点击/输入/选择/上传文件
├── 多标签管理
├── 浏览器配置文件（持久登录状态）
└── 登录辅助
```

### 配置

```json5
{
  tools: {
    browser: {
      enabled: true,
      headless: true,               // 无头模式
      chromePath: "/path/to/chrome", // 自定义 Chrome 路径
      profiles: {
        default: {
          dataDir: "~/.openclaw/browser-profiles/default"
        }
      }
    }
  }
}
```

## Canvas 系统

### 概述

Canvas 是 Agent 驱动的可视化工作空间，Agent 可以创建和操控网页内容。

```
src/canvas-host/
├── server.ts              # Canvas HTTP 服务器
├── a2ui/                  # A2UI (Agent-to-UI) 系统
│   └── .bundle.hash       # A2UI bundle hash
└── ...

HTTP 路径:
/__openclaw__/canvas/       # Agent 编辑的 HTML/CSS/JS
/__openclaw__/a2ui/         # A2UI 通信宿主
```

### A2UI (Agent-to-UI)

A2UI 是 OpenClaw 的创新概念——Agent 直接控制 UI：

```
Agent                    Canvas Host              用户浏览器
  │                          │                         │
  ├── canvas.push ─────────→│ 存储 HTML/CSS/JS ─────→│ 渲染
  │   {html, css, js}       │                         │
  │                          │                         │
  ├── canvas.eval ─────────→│ 注入 JS ──────────────→│ 执行
  │   {script}              │                         │
  │                          │                         │
  ├── canvas.snapshot ─────→│ 截图 ←─────────────────│
  │                          │                         │
  └── canvas.reset ────────→│ 清空 ─────────────────→│ 空白
```

用途示例：
- Agent 生成交互式数据可视化
- 实时显示代码运行结果
- 创建临时 Web 应用供用户交互
- 显示地图、图表、表格等

## Node 能力系统

### 架构

```
src/node-host/
├── Node 注册表（NodeRegistry）
├── 能力路由
└── 命令分发

Gateway ←── WebSocket ──→ Node 设备
                           (macOS/iOS/Android)
```

### Node 连接注册

```typescript
// Node 连接时声明的能力
{
  role: "node",
  deviceId: "iPhone-ABC",
  platform: "ios",
  caps: [
    "camera",        // 相机
    "screen",        // 屏幕录制
    "location",      // 位置
    "canvas",        // Canvas 渲染
    "notifications", // 通知
    "contacts",      // 联系人
    "calendar",      // 日历
    "photos",        // 相册
    "motion",        // 运动传感器
    "sms"            // 短信（Android 独有）
  ],
  commands: [
    "camera.snap",        // 拍照
    "camera.clip",        // 录像
    "screen.record",      // 屏幕录制
    "location.get",       // 获取位置
    "canvas.push",        // 推送 Canvas
    "canvas.eval",        // 执行 Canvas JS
    "canvas.snapshot",    // Canvas 截图
    "system.notify",      // 系统通知
    "system.run"          // 系统命令（需审批）
  ]
}
```

### 调用流程

```
Agent 调用 camera.snap
    │
    ├── 1. Gateway 查找可用 Node
    │   └── NodeRegistry.findCapable("camera")
    │
    ├── 2. 选择最佳 Node（移动端 > 桌面端）
    │
    ├── 3. 发送命令到 Node
    │   └── WS: {type:"req", method:"invoke", params:{cmd:"camera.snap"}}
    │
    ├── 4. Node 执行
    │   ├── iOS: CameraController
    │   └── Android: CameraCaptureManager
    │
    ├── 5. 返回结果（图片数据: base64 或临时文件 URL）
    │
    └── 6. Agent 获得结果（作为工具结果加入上下文）
```

### 平台特有能力

```
iOS + Android 共有:
├── camera.snap / camera.clip
├── screen.record
├── location.get
├── canvas.push / canvas.eval / canvas.snapshot
├── contacts.list
├── calendar.*
├── photos.*
├── motion.*
└── system.notify

Android 独有:
├── sms.send / sms.list        # 短信
├── calllog.*                   # 通话记录
├── notifications.list          # 通知监听
└── device.update               # 应用更新检查
```

## Cron 系统

### 架构

```
src/cron/
├── 定时任务调度器
├── 任务定义与持久化
└── 执行管理

工作流程:
1. Agent 或用户通过 cron 工具创建定时任务
2. Gateway 的 cron 调度器管理计划
3. 到期时创建隔离的 Agent 会话执行
4. 结果可选发送到指定通道

特点:
├── 隔离 Cron jobs 每次运行 mint 新 sessionId（无复用）
├── Cron lane 独立于 main lane（不阻塞入站回复）
└── 可指定不同模型
```

### 任务配置

```json5
{
  // 通过 Agent 工具创建
  cron_create: {
    schedule: "0 9 * * *",      // 标准 cron 表达式
    prompt: "检查我的日程，给我早间简报",
    session: "cron:morning-brief",
    channel: "whatsapp",
    target: "+8613800138000"
  },

  // 通过配置文件
  cron: {
    jobs: [
      {
        id: "morning-brief",
        schedule: "0 9 * * *",
        prompt: "给我今日简报",
        deliverTo: { channel: "telegram", target: "tg:123456" }
      },
      {
        id: "weekly-review",
        schedule: "0 10 * * 1",   // 每周一
        prompt: "总结上周工作",
        model: "anthropic/claude-opus-4-6"   // 可指定模型
      }
    ]
  }
}
```

### Heartbeat vs Cron

```
Cron:
├── 标准 cron 表达式
├── 每次创建新的隔离会话
├── 适合周期性任务
└── 独立 cron lane

Heartbeat:
├── 固定间隔心跳
├── 可以复用会话
├── 适合状态检查和持续监控
├── 智能默认:
│   ├── OAuth profiles: heartbeat=1h
│   └── API key profiles: heartbeat=30m
└── 用于保持 prompt cache 温暖
```

## Skills 系统

### 加载位置（优先级从高到低）

```
1. Workspace Skills:  <workspace>/skills/
   └── 工作空间级别，优先级最高（per-agent）

2. Managed Skills:    ~/.openclaw/skills/
   └── 用户级别，通过 ClawHub 安装（跨 agent 共享）

3. Bundled Skills:    <install>/skills/
   └── OpenClaw 自带
```

### Skill 定义

```markdown
--- (SKILL.md frontmatter)
name: "Morning Brief"
description: "Generate a morning briefing"
trigger:
  command: "/morning"        # 斜杠命令触发
  # 或 schedule: "0 9 * * *"  # 定时触发
config:
  model: "anthropic/claude-sonnet-4-6"
  thinking: "low"
---

# Morning Brief Skill

Generate a personalized morning briefing including:
1. Today's calendar events
2. Weather forecast
...
```

### 系统提示中的 Skills 注入

Skills 在系统提示中以紧凑列表形式注入（仅名称+描述+路径），模型按需使用 `read` 工具加载完整 SKILL.md：

```xml
<available_skills>
  <skill>
    <name>Morning Brief</name>
    <description>Generate a morning briefing</description>
    <location>/path/to/skills/morning-brief/SKILL.md</location>
  </skill>
</available_skills>
```

## Webhook 系统

```json5
{
  webhooks: {
    endpoints: [
      {
        id: "github-push",
        path: "/hooks/github",         // HTTP POST 路径
        secret: "webhook-secret",       // 签名验证
        prompt: "处理 GitHub push 事件: {{payload}}",
        session: "hook:github",
        deliverTo: { channel: "discord", target: "channel:123" }
      }
    ]
  }
}

// 工作流程:
// 1. 外部服务发送 HTTP POST 到 Gateway /hooks/github
// 2. 验证签名（secret）
// 3. 创建 Agent 会话处理 payload（注入到 prompt）
// 4. 结果发送到指定通道
```

## 工具权限控制

### Per-Agent 工具策略

```json5
{
  agents: {
    list: [
      {
        id: "main"
        // 不限制 — 所有工具可用
      },
      {
        id: "family",
        tools: {
          allow: ["read", "exec", "sessions_list", "sessions_send"],
          deny: ["write", "edit", "apply_patch", "browser", "canvas", "cron"]
        }
      },
      {
        id: "restricted",
        tools: {
          allow: ["read"],     // 只能读文件
          deny: ["*"]          // 其他全部禁止（* 通配符）
        },
        sandbox: {
          mode: "all",         // 所有操作在 Docker 沙箱中
          scope: "agent"       // 每个 Agent 独立容器
        }
      }
    ]
  }
}

// 规则:
// ├── tools.allow + tools.deny 支持 * 通配符
// ├── deny 优先（deny wins）
// ├── 匹配不区分大小写
// └── 空 allow 列表 = 所有工具允许
```

### 全局提升工具（Elevated Tools）

```json5
{
  tools: {
    elevated: {
      // 只有特定发送者可以使用的高权限工具
      senders: ["+8613800138000"],
      tools: ["system.run"]   // 系统命令执行
    }
  }
}
// 注意: tools.elevated 是全局的、基于发送者的，不能 per-agent 配置
```

## 执行审批（Exec Approvals）

### Human-in-the-Loop 机制

```
Agent 请求执行高风险命令（如 system.run）
    │
    ├── 检查工具策略 (tools.allow / tools.deny)
    │
    ├── 需要审批时:
    │   ├── Gateway 创建审批请求
    │   ├── 推送到所有连接的 UI 客户端:
    │   │   ├── macOS App: 弹出审批对话框
    │   │   ├── CLI: 终端提示
    │   │   ├── WebChat: 审批 UI
    │   │   └── iOS/Android: 推送通知
    │   ├── 用户审批/拒绝:
    │   │   ├── 批准 → 执行命令
    │   │   ├── 拒绝 → 返回拒绝信息给 Agent
    │   │   └── 超时 → 自动拒绝
    │   └── 审批可配置绕过（Node 配置）
    │
    └── 自动批准时:
        └── 直接执行
```

### 配置

```json5
{
  tools: {
    exec: {
      approval: {
        required: true,                    // 默认需要审批
        bypassForTrustedNodes: false,      // Node 绕过
        timeout: 300                       // 超时秒数
      }
    }
  }
}
```

## 循环检测（Loop Detection）

```
防止 Agent 陷入无限工具调用循环:

检测策略:
├── 计数连续相同工具调用
├── 检测输出重复模式
└── 达到阈值 → 终止并提醒用户

内置行为，无需额外配置。
```

## 工具结果处理

```
工具结果经过的处理管道:

1. 大小清理: 内置工具已截断自己的输出
2. 图片负载清理: 大图片压缩或引用化
3. tool_result_persist 钩子: 同步转换结果（写入转录前）
4. Session Pruning: 旧工具结果在 LLM 调用前修剪
   （不修改磁盘上的 JSONL 历史）
5. after_tool_call 钩子: 工具执行后的可选处理

"NO_REPLY" 处理:
├── 被视为静默 token，从出站 payload 中过滤
├── 消息工具重复被移除
└── 无可渲染 payload + 工具出错 → 回退工具错误回复
```
