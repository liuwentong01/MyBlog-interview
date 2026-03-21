# 09 - 客户端应用架构

## 概述

OpenClaw 是一个多平台系统，除了核心 Gateway（Node.js）外，还有多个客户端应用连接到 Gateway 进行交互。

```
                    Gateway (Node.js)
                   ws://127.0.0.1:18789
                          │
          ┌───────────────┼───────────────────┐
          │               │                   │
    ┌─────┴─────┐   ┌────┴────┐   ┌─────────┴─────────┐
    │  macOS App │   │ CLI     │   │  Control UI (Web)  │
    │  (Swift)   │   │(Node.js)│   │  (Lit + Vite)      │
    └───────────┘   └─────────┘   └────────────────────┘
          │
    ┌─────┴──────────────┐
    │ iOS App  │ Android  │
    │ (Swift)  │ (Kotlin) │
    └──────────┴──────────┘
```

## macOS 应用

### Swabble 框架

macOS 应用基于 **Swabble** 框架（项目根目录的 `Swabble/`），一个 Swift 语音助手框架：

```
Swabble/
├── Package.swift                # Swift Package Manager
├── Sources/
│   ├── SwabbleCore/
│   │   ├── Config/
│   │   │   └── Config.swift              # 配置管理
│   │   ├── Hooks/
│   │   │   └── HookExecutor.swift        # 钩子执行器
│   │   ├── Speech/
│   │   │   ├── BufferConverter.swift      # 音频缓冲转换
│   │   │   └── SpeechPipeline.swift       # 语音管道
│   │   └── Support/
│   │       ├── Logging.swift              # 日志
│   │       ├── OutputFormat.swift         # 输出格式
│   │       ├── TranscriptsStore.swift     # 转录存储
│   │       └── AttributedString+Sentences.swift
│   │
│   ├── SwabbleKit/
│   │   └── WakeWordGate.swift            # 唤醒词检测
│   │
│   └── swabble/
│       ├── CLI/
│       │   └── CLIRegistry.swift         # CLI 命令注册
│       ├── Commands/                      # CLI 命令
│       │   ├── DoctorCommand.swift
│       │   ├── ServeCommand.swift
│       │   ├── SetupCommand.swift
│       │   ├── TranscribeCommand.swift
│       │   ├── MicCommands.swift
│       │   └── ...
│       └── main.swift
│
└── Tests/
    ├── SwabbleKitTests/
    │   └── WakeWordGateTests.swift
    └── swabbleTests/
        └── ConfigTests.swift
```

### macOS 应用功能

```
macOS App (Menu Bar):
├── 菜单栏控制平面
│   ├── Gateway 状态显示
│   ├── 通道状态一览
│   └── 快速操作入口
│
├── Voice Wake（唤醒词）
│   ├── 始终监听唤醒词
│   ├── 检测到后激活 Talk 模式
│   └── 自定义唤醒词配置
│
├── Talk Mode（语音对话）
│   ├── 按键说话 (PTT)
│   ├── 持续语音模式
│   ├── ElevenLabs TTS + 系统 TTS 回退
│   └── 浮动覆盖 UI
│
├── WebChat（内嵌 Web 聊天）
│   └── 使用 Gateway WS API
│
├── Canvas（可视化工作区）
│   └── 渲染 Agent 推送的 HTML/CSS/JS
│
├── 调试工具
│   ├── 日志查看
│   ├── 会话检查
│   └── 网络状态
│
└── 远程 Gateway 控制
    └── 连接远程 Gateway（via Tailscale/SSH）
```

## iOS 应用

### 项目结构

```
apps/ios/
├── Sources/
│   ├── OpenClawApp.swift           # 应用入口
│   ├── RootView.swift              # 根视图
│   ├── RootTabs.swift              # 标签页导航
│   ├── RootCanvas.swift            # Canvas 根视图
│   ├── HomeToolbar.swift           # 主页工具栏
│   ├── SessionKey.swift            # 会话键管理
│   │
│   ├── Gateway/                    # Gateway 连接
│   │   ├── GatewayConnectionController.swift  # 连接控制器
│   │   ├── GatewayDiscoveryModel.swift        # Bonjour 发现
│   │   ├── GatewayServiceResolver.swift       # 服务解析
│   │   ├── GatewayHealthMonitor.swift         # 健康监控
│   │   ├── GatewaySettingsStore.swift         # 设置存储
│   │   ├── GatewaySetupCode.swift             # 设置码
│   │   ├── GatewayTrustPromptAlert.swift      # 信任提示
│   │   ├── GatewayConnectConfig.swift         # 连接配置
│   │   ├── KeychainStore.swift                # 钥匙串存储
│   │   └── TCPProbe.swift                     # TCP 探测
│   │
│   ├── Chat/                       # 聊天功能
│   │   ├── ChatSheet.swift         # 聊天面板
│   │   └── IOSGatewayChatTransport.swift  # 聊天传输
│   │
│   ├── Camera/                     # 相机能力
│   │   └── CameraController.swift
│   │
│   ├── Screen/                     # 屏幕录制
│   │   ├── ScreenController.swift
│   │   ├── ScreenRecordService.swift
│   │   └── ScreenTab.swift
│   │
│   ├── Location/                   # 位置服务
│   │   ├── LocationService.swift
│   │   └── SignificantLocationMonitor.swift
│   │
│   ├── Contacts/                   # 联系人
│   │   └── ContactsService.swift
│   │
│   ├── Calendar/                   # 日历
│   │   └── CalendarService.swift
│   │
│   ├── Media/                      # 媒体
│   │   └── PhotoLibraryService.swift
│   │
│   ├── Motion/                     # 运动传感器
│   │   └── MotionService.swift
│   │
│   ├── Capabilities/               # Node 能力路由
│   │   └── NodeCapabilityRouter.swift
│   │
│   ├── Model/                      # 数据模型
│   │   ├── NodeAppModel.swift      # 应用数据模型
│   │   └── NodeAppModel+Canvas.swift
│   │
│   ├── Onboarding/                 # 新手引导
│   │   ├── OnboardingWizardView.swift
│   │   ├── GatewayOnboardingView.swift
│   │   ├── OnboardingStateStore.swift
│   │   └── QRScannerView.swift    # 二维码扫描配对
│   │
│   ├── LiveActivity/               # 实时活动（灵动岛）
│   │   ├── LiveActivityManager.swift
│   │   └── OpenClawActivityAttributes.swift
│   │
│   ├── Push/                       # 推送通知
│   │   ├── PushRegistrationManager.swift
│   │   └── PushRelayClient.swift
│   │
│   ├── Settings/                   # 设置
│   │   └── SettingsTab.swift
│   │
│   └── Services/                   # 服务层
│       ├── NodeServiceProtocols.swift
│       ├── NotificationService.swift
│       └── WatchMessagingService.swift
│
├── ShareExtension/                 # 分享扩展
│   └── ShareViewController.swift
│
├── ActivityWidget/                 # 实时活动 Widget
│   └── OpenClawLiveActivity.swift
│
└── Config/
    ├── Signing.xcconfig
    └── Version.xcconfig
```

### iOS 应用作为 Node

iOS 应用作为 Gateway 的 Node 连接，提供设备能力：

```
iOS Node 能力:
├── camera.snap     → CameraController
├── camera.clip     → CameraController (视频)
├── screen.record   → ScreenRecordService
├── location.get    → LocationService
├── canvas.push     → RootCanvas (WebView 渲染)
├── canvas.eval     → RootCanvas (JS 执行)
├── canvas.snapshot → RootCanvas (截图)
├── contacts.list   → ContactsService
├── calendar.*      → CalendarService
├── photos.*        → PhotoLibraryService
├── motion.*        → MotionService
└── system.notify   → NotificationService
```

### Bonjour 自动发现

```
iOS 设备 ←── Bonjour/mDNS ──→ Gateway (macOS)

1. Gateway 广播 mDNS 服务
2. iOS App 自动发现同网络的 Gateway
3. 用户选择 Gateway 进行配对
4. 或扫描 QR 码快速配对
```

## Android 应用

### 项目结构

```
apps/android/
├── app/src/main/java/ai/openclaw/app/
│   ├── MainActivity.kt              # 主 Activity
│   ├── MainViewModel.kt             # 主 ViewModel
│   ├── NodeApp.kt                   # Node 应用
│   ├── NodeRuntime.kt               # Node.js 运行时
│   ├── NodeForegroundService.kt     # 前台服务
│   │
│   ├── gateway/                     # Gateway 连接
│   │   ├── GatewaySession.kt        # Gateway 会话
│   │   ├── GatewayDiscovery.kt      # Bonjour 发现
│   │   ├── GatewayEndpoint.kt       # 端点配置
│   │   ├── GatewayProtocol.kt       # 协议实现
│   │   ├── GatewayTls.kt            # TLS 支持
│   │   ├── DeviceAuthStore.kt       # 设备认证
│   │   ├── DeviceIdentityStore.kt   # 设备身份
│   │   └── DeviceAuthPayload.kt     # 认证负载
│   │
│   ├── chat/                        # 聊天功能
│   │   ├── ChatController.kt        # 聊天控制器
│   │   └── ChatModels.kt            # 聊天数据模型
│   │
│   ├── node/                        # Node 能力处理器
│   │   ├── InvokeDispatcher.kt      # 命令分发
│   │   ├── InvokeCommandRegistry.kt # 命令注册
│   │   ├── ConnectionManager.kt     # 连接管理
│   │   ├── CameraHandler.kt         # 相机
│   │   ├── CameraCaptureManager.kt  # 相机管理
│   │   ├── LocationHandler.kt       # 位置
│   │   ├── ContactsHandler.kt       # 联系人
│   │   ├── CalendarHandler.kt       # 日历
│   │   ├── PhotosHandler.kt         # 相册
│   │   ├── SmsHandler.kt            # 短信
│   │   ├── NotificationsHandler.kt  # 通知
│   │   ├── MotionHandler.kt         # 运动传感器
│   │   ├── DeviceHandler.kt         # 设备信息
│   │   ├── SystemHandler.kt         # 系统命令
│   │   ├── CanvasController.kt      # Canvas 控制
│   │   ├── DebugHandler.kt          # 调试
│   │   └── A2UIHandler.kt           # A2UI 处理
│   │
│   ├── voice/                       # 语音功能
│   │   ├── TalkModeManager.kt       # Talk 模式
│   │   ├── MicCaptureManager.kt     # 麦克风
│   │   ├── VoiceWakeManager.kt      # 语音唤醒
│   │   └── TalkDirectiveParser.kt   # 指令解析
│   │
│   ├── ui/                          # UI 层
│   │   ├── RootScreen.kt            # 根屏幕
│   │   ├── ConnectTabScreen.kt      # 连接标签
│   │   ├── VoiceTabScreen.kt        # 语音标签
│   │   ├── ChatSheet.kt             # 聊天面板
│   │   ├── CanvasScreen.kt          # Canvas 屏幕
│   │   ├── OnboardingFlow.kt        # 新手引导
│   │   ├── SettingsSheet.kt         # 设置
│   │   └── chat/                    # 聊天 UI 组件
│   │
│   ├── tools/                       # 工具展示
│   │   └── ToolDisplay.kt
│   │
│   └── protocol/                    # 协议常量
│       ├── OpenClawProtocolConstants.kt
│       └── OpenClawCanvasA2UIAction.kt
│
└── build.gradle.kts
```

### Android 特有能力

Android 相比 iOS 额外提供：
```
Android 独有:
├── sms.send     → SmsHandler（发送短信）
├── sms.list     → SmsHandler（读取短信）
├── calllog.*    → CallLogHandler（通话记录）
├── notifications.list → 通知监听服务
└── device.update → 应用更新检查
```

## CLI（命令行界面）

### 结构

```
src/cli/
├── deps.ts          # 依赖注入 (createDefaultDeps)
├── progress.ts      # 进度指示器 (osc-progress + @clack/prompts)
├── command-format.ts # 命令格式化
└── ...

src/commands/
├── agent.ts         # openclaw agent --message "..."
├── gateway.ts       # openclaw gateway [run|restart|stop]
├── onboard.ts       # openclaw onboard
├── send.ts          # openclaw message send
├── status.ts        # openclaw status
├── doctor.ts        # openclaw doctor
├── config.ts        # openclaw config
├── channels.ts      # openclaw channels
├── sessions.ts      # openclaw sessions
├── models.ts        # openclaw models
├── plugins.ts       # openclaw plugins
├── cron.ts          # openclaw cron
├── pairing.ts       # openclaw pairing
├── browser.ts       # openclaw browser
├── security.ts      # openclaw security
└── ...
```

### 关键 CLI 命令

```bash
# 安装 & 设置
openclaw onboard --install-daemon   # 交互式设置向导
openclaw setup                      # 创建配置 + 工作空间
openclaw doctor                     # 诊断检查

# Gateway 管理
openclaw gateway run --port 18789   # 启动 Gateway
openclaw gateway restart            # 重启
openclaw gateway stop               # 停止

# 消息
openclaw agent --message "..." --thinking high  # 直接与 Agent 对话
openclaw message send --to +86... --message "Hi"  # 发送消息

# 通道管理
openclaw channels status --probe    # 通道状态
openclaw channels login --channel whatsapp  # 登录通道

# 会话管理
openclaw sessions --json            # 列出会话
openclaw sessions cleanup --dry-run # 清理预览

# 模型管理
openclaw models list                # 列出可用模型
openclaw models set anthropic/claude-opus-4-6  # 设置默认模型
openclaw models auth login --provider openai   # 模型认证

# 其他
openclaw update --channel stable    # 更新
openclaw plugins list               # 插件列表
openclaw security audit             # 安全审计
```

## Control UI（Web 界面）

### 技术栈

```
ui/
├── index.html          # 入口 HTML
├── package.json        # 独立包
├── vite.config.ts      # Vite 构建配置
├── src/
│   ├── main.ts         # 入口
│   ├── styles.css      # 全局样式
│   ├── i18n/           # 国际化
│   ├── ui/             # UI 组件
│   └── local-storage.ts # 本地存储
└── public/             # 静态资源

技术选型:
├── Lit (Web Components)  # UI 框架
├── Vite                   # 构建工具
├── TypeScript             # 语言
└── Legacy Decorators      # Lit 装饰器（@state, @property）
```

### 功能

```
Control UI 功能:
├── Dashboard（仪表板）
│   ├── Gateway 健康状态
│   ├── 通道连接状态
│   ├── 活跃会话列表
│   └── 系统指标
│
├── Chat（聊天）
│   ├── WebChat 界面
│   ├── 多会话切换
│   └── 媒体消息支持
│
├── Sessions（会话管理）
│   ├── 会话列表
│   ├── 会话详情/历史
│   └── 会话重置/删除
│
├── Channels（通道管理）
│   ├── 通道状态
│   ├── 通道配置
│   └── 配对管理
│
├── Skills（技能管理）
│   ├── 已安装技能
│   ├── 启用/禁用
│   └── ClawHub 浏览
│
├── Settings（设置）
│   ├── 模型配置
│   ├── Agent 配置
│   └── 安全设置
│
└── Logs（日志）
    └── 实时日志流
```

## 协议类型与代码生成

OpenClaw 的跨平台通信使用类型安全的协议定义：

```
TypeBox Schema (TypeScript)
    │
    ├──→ JSON Schema → Swift 模型生成 (iOS/macOS)
    │
    └──→ Kotlin 手动对齐 (Android)

这确保了所有平台使用一致的协议定义。
```
