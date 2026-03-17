# Module Federation (模块联邦) — 面试流程图

> 对应文件: `module-federation-demo.js`

## 1. 解决什么问题?

```mermaid
flowchart TD
    subgraph TRADITIONAL ["传统方式"]
        T1["应用 A 开发 Button 组件"]
        T2["发布 npm 包"]
        T3["应用 B npm install"]
        T4["应用 B 重新构建"]
        T5["A 更新 → 重新发包 → B 重新安装 → 重新构建"]
        T1 --> T2 --> T3 --> T4
        T4 -.-> T5
    end

    subgraph MF ["Module Federation"]
        M1["应用 A 声明暴露 Button"]
        M2["应用 B 声明消费 A 的 Button"]
        M3["运行时: B 加载 A 的 remoteEntry.js"]
        M4["直接使用 Button, 无需重新构建"]
        M5["A 更新 → B 下次加载自动获取最新"]
        M1 --> M2 --> M3 --> M4
        M4 -.-> M5
    end

    style TRADITIONAL fill:#f8d7da,stroke:#dc3545
    style MF fill:#d4edda,stroke:#28a745
```

## 2. 核心概念

```mermaid
flowchart TD
    MF["Module Federation"]

    MF --> HOST["Host (宿主)<br/>消费远程模块的应用<br/>配置: remotes"]
    MF --> REMOTE["Remote (远程)<br/>暴露模块的应用<br/>配置: exposes"]
    MF --> CONTAINER["Container (容器)<br/>每个应用的运行时入口<br/>暴露 init() + get()"]
    MF --> SHARED["Shared (共享)<br/>多应用公用的依赖<br/>如 React, 避免重复加载"]

    style MF fill:#4a90d9,color:#fff
    style HOST fill:#e8f4fd,stroke:#4a90d9
    style REMOTE fill:#fff3cd,stroke:#ffc107
    style CONTAINER fill:#f5a623,color:#fff
    style SHARED fill:#d4edda,stroke:#28a745
```

## 3. Container 协议 (init + get)

```mermaid
flowchart TD
    subgraph CONTAINER_API ["Container 两个核心方法"]
        INIT["container.init(shareScope)<br/>-------<br/>1. 接收全局共享作用域<br/>2. 将自己的共享依赖注册进去<br/>3. 其他容器就能使用这些依赖"]

        GET["container.get(moduleName)<br/>-------<br/>1. 查找 exposes 中的模块<br/>2. 返回 Promise of moduleFactory<br/>3. 调用 factory() 获取 exports"]
    end

    HOST["Host 应用"] -->|"1. 加载 remoteEntry.js"| SCRIPT["script 标签加载<br/>window.appA = container"]

    SCRIPT -->|"2. 初始化"| INIT
    INIT -->|"3. 获取模块"| GET
    GET -->|"4. 执行工厂"| USE["factory() → module.exports<br/>拿到远程组件"]

    style HOST fill:#4a90d9,color:#fff
    style USE fill:#d4edda,stroke:#28a745
```

## 4. Shared 依赖版本协商

```mermaid
flowchart TD
    APPA["应用 A<br/>shared: react@18.2.0"]
    APPB["应用 B<br/>shared: react@18.3.0"]

    APPA -->|"init(shareScope)"| SS["全局 shareScope"]
    APPB -->|"init(shareScope)"| SS

    SS --> SCOPE["shareScope = {<br/>  react: {<br/>    '18.2.0': { get: fn, from: 'appA' },<br/>    '18.3.0': { get: fn, from: 'appB' }<br/>  }<br/>}"]

    SCOPE --> SELECT{"选择版本策略"}
    SELECT -->|"兼容"| HIGHEST["选最高版本: 18.3.0<br/>两个应用共用一份 React"]
    SELECT -->|"不兼容<br/>(如 React 17 vs 18)"| SEPARATE["各用各的版本"]

    style APPA fill:#e8f4fd,stroke:#4a90d9
    style APPB fill:#fff3cd,stroke:#ffc107
    style SS fill:#f5a623,color:#fff
    style HIGHEST fill:#d4edda,stroke:#28a745
```

## 5. 完整运行时流程

```mermaid
flowchart TD
    CODE["Host 源码:<br/>import('appA/Button')"]

    CODE -->|"webpack 编译后"| STEP1["require.e('webpack/container/reference/appA')<br/>加载远程 entry (复用 JSONP 机制)"]

    STEP1 --> STEP2["require.I('default')<br/>初始化远程容器<br/>appA.init(shareScope)"]

    STEP2 --> STEP3["appA.get('./Button')<br/>从容器获取模块工厂"]

    STEP3 --> STEP4["factory()<br/>执行工厂函数<br/>获取 module.exports"]

    STEP4 --> USE["使用远程组件<br/>Button({ text: 'Click me' })"]

    STEP1 -.- NOTE1["与 import() 复用同一套<br/>JSONP + require.e 加载机制"]

    style CODE fill:#4a90d9,color:#fff
    style STEP1 fill:#f5a623,color:#fff
    style USE fill:#d4edda,stroke:#28a745
```

## 6. webpack 配置对照

```mermaid
flowchart LR
    subgraph REMOTE_CONFIG ["应用 A (Remote) 配置"]
        RC["new ModuleFederationPlugin({<br/>  name: 'appA',<br/>  filename: 'remoteEntry.js',<br/>  exposes: {<br/>    './Button': './src/Button'<br/>  },<br/>  shared: ['react']<br/>})"]
    end

    subgraph HOST_CONFIG ["应用 B (Host) 配置"]
        HC["new ModuleFederationPlugin({<br/>  name: 'appB',<br/>  remotes: {<br/>    appA: 'appA@http://a.com/remoteEntry.js'<br/>  },<br/>  shared: ['react']<br/>})"]
    end

    RC -.->|"运行时加载"| HC

    style REMOTE_CONFIG fill:#fff3cd,stroke:#ffc107
    style HOST_CONFIG fill:#e8f4fd,stroke:#4a90d9
```

**面试要点:**
- MF 解决"跨应用运行时共享模块"问题, 无需 npm 发包、无需重新构建
- Container 协议: `init(shareScope)` 注册共享依赖, `get(moduleName)` 获取暴露模块
- Shared 版本协商: 同一 shareScope 内选最高兼容版本, 不兼容则各用各的
- 底层复用 webpack 的 JSONP + require.e 异步加载机制
- 典型场景: 微前端、多团队独立开发、组件库运行时分发
