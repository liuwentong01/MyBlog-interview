# 异步模块加载 (import() 运行时) — 面试流程图

> 对应文件: `async-loader-demo.js`

## 完整调用链

```mermaid
flowchart TD
    SOURCE["源码: import('./test.js')"]

    SOURCE -->|"webpack 编译转换"| COMPILED["require.e('src_test_js')<br/>.then(require.bind(require, './src/test.js'))"]

    COMPILED --> RE["require.e(chunkId)<br/>遍历 require.f 中所有加载策略<br/>收集 promises → Promise.all"]

    RE --> STRATEGIES{"require.f 策略分发<br/>(策略模式, 可扩展)"}

    STRATEGIES --> FJ["require.f.j<br/>JSONP 加载 JS chunk"]
    STRATEGIES --> FCSS["require.f.miniCss<br/>加载 CSS chunk"]
    STRATEGIES --> FPRE["require.f.prefetch<br/>预取 (不阻塞)"]

    subgraph JSONP_FLOW ["require.f.j 详细流程"]
        direction TB
        J1{"检查 installedChunks[chunkId]"}
        J2["= 0 → 已加载, 直接跳过"]
        J3["= [r,j,p] → 加载中<br/>复用已有 promise"]
        J4["= undefined → 未加载<br/>创建新 promise"]

        J1 -->|"已加载"| J2
        J1 -->|"加载中"| J3
        J1 -->|"未加载"| J4

        J4 --> J5["创建 Promise<br/>installedChunks[id] = [resolve, reject]<br/>promise 存为第三个元素"]
        J5 --> J6["require.l(url, done)<br/>创建 script 标签<br/>设置 src = publicPath + chunkId + '.main.js'<br/>插入 document.head"]
        J6 --> J7["浏览器下载并执行脚本"]
    end

    FJ --> J1

    J7 --> SCRIPT["脚本内容:<br/>self.webpackChunkstudy.push(<br/>  [chunkIds, moreModules, runtime]<br/>)<br/>-------<br/>push 已被劫持为 webpackJsonpCallback"]

    SCRIPT --> CALLBACK["webpackJsonpCallback 执行"]

    subgraph CALLBACK_FLOW ["webpackJsonpCallback 4 步"]
        CB1["1. resolve 对应 chunk 的 Promise<br/>installedChunks[id][0]()"]
        CB2["2. 设置 installedChunks[id] = 0<br/>(标记为已加载)"]
        CB3["3. 合并 moreModules 到全局 modules<br/>modules[moduleId] = moreModules[moduleId]"]
        CB4["4. 检查 require.O 延迟队列<br/>(splitChunks 场景)"]
        CB1 --> CB2 --> CB3 --> CB4
    end

    CALLBACK --> CB1

    CB4 --> ALL["Promise.all 等待所有策略完成<br/>(JS + CSS 都加载好了)"]

    ALL --> SYNC_REQ["require('./src/test.js')<br/>此时模块已在 modules 中<br/>同步执行并返回 exports"]

    SYNC_REQ --> USE["调用方使用模块<br/>.then(module => module.default())"]

    style SOURCE fill:#4a90d9,color:#fff
    style COMPILED fill:#4a90d9,color:#fff
    style RE fill:#f5a623,color:#fff
    style CALLBACK fill:#dc3545,color:#fff
    style ALL fill:#d4edda,stroke:#28a745
    style USE fill:#d4edda,stroke:#28a745
```

## push 劫持 + 竞态处理

```mermaid
flowchart TD
    INIT["初始化阶段"]

    INIT --> G1["var chunkLoadingGlobal =<br/>self.webpackChunkstudy =<br/>self.webpackChunkstudy || []"]

    G1 --> G2["chunkLoadingGlobal.forEach(<br/>webpackJsonpCallback.bind(null, 0))<br/>-------<br/>处理竞态: 如果异步 chunk 在主入口<br/>之前就到达了,数据已在数组中"]

    G2 --> G3["chunkLoadingGlobal.push =<br/>webpackJsonpCallback.bind(null, 0)<br/>-------<br/>劫持 push: 之后所有 push 调用<br/>都走 webpackJsonpCallback"]

    style INIT fill:#4a90d9,color:#fff
    style G2 fill:#fff3cd,stroke:#ffc107
    style G3 fill:#f8d7da,stroke:#dc3545
```

## installedChunks 三种状态速查

```mermaid
flowchart LR
    subgraph STATE ["installedChunks[chunkId] 的三种状态"]
        S0["0<br/>已加载完成"]
        S1["[resolve, reject, promise]<br/>正在加载中"]
        S2["undefined<br/>尚未加载"]
    end

    style S0 fill:#d4edda,stroke:#28a745
    style S1 fill:#fff3cd,stroke:#ffc107
    style S2 fill:#e8f4fd,stroke:#4a90d9
```

**面试要点:**
- `import()` 编译后变成 `require.e + require.bind` 的组合
- **策略模式**: `require.f` 是注册表, JS/CSS/prefetch 各自注册策略, `require.e` 统一编排
- **JSONP 而非 fetch**: 天然跨域、不触发 CSP、push 劫持 = 加载回调
- **竞态处理**: forEach 先处理可能已到达的数据, 再劫持 push
- `require.O` 处理 splitChunks 入口协调 (main.js 依赖 vendors.js 的场景)
