# Loader 管线 — 面试流程图

> 对应文件: `loader-pipeline-demo.js`

## 1. Loader 完整执行流程

```mermaid
flowchart TD
    CONFIG["配置: use: [style-loader, css-loader, sass-loader]"]

    CONFIG --> PHASE1["阶段 1: Pitch 阶段 (从左到右)"]

    subgraph PITCH ["Pitch 阶段"]
        direction TB
        P1["style-loader.pitch(<br/>remainingRequest, previousRequest, data)"]
        P2["css-loader.pitch(...)"]
        P3["sass-loader.pitch(...)"]
        P1 -->|"无返回值, 继续"| P2 -->|"无返回值, 继续"| P3
    end

    PHASE1 --> PITCH

    P3 -->|"Pitch 全部完成"| PHASE2["阶段 2: 读取源文件<br/>readFile(resource)"]

    PHASE2 --> PHASE3["阶段 3: Normal 阶段 (从右到左)"]

    subgraph NORMAL ["Normal 阶段"]
        direction TB
        N1["sass-loader(source)<br/>SCSS → CSS"]
        N2["css-loader(cssString)<br/>CSS → JS module"]
        N3["style-loader(jsModule)<br/>注入 style 标签"]
        N1 --> N2 --> N3
    end

    PHASE3 --> NORMAL

    N3 --> RESULT["最终结果: 可被 webpack 处理的 JS 代码"]

    style CONFIG fill:#4a90d9,color:#fff
    style PHASE1 fill:#f5a623,color:#fff
    style PHASE2 fill:#f5a623,color:#fff
    style PHASE3 fill:#f5a623,color:#fff
    style RESULT fill:#d4edda,stroke:#28a745
```

## 2. Pitch 熔断机制 (style-loader 的真正原理)

```mermaid
flowchart TD
    START["use: [style-loader, css-loader, sass-loader]"]

    START --> SP["style-loader.pitch()"]
    SP -->|"无返回值, 继续"| CP["css-loader.pitch()"]

    CP -->|"返回了内容!"| BAIL["Pitch 熔断!"]

    BAIL --> SKIP1["跳过 sass-loader.pitch()"]
    BAIL --> SKIP2["跳过读取源文件"]
    BAIL --> SKIP3["跳过 sass-loader.normal()"]
    BAIL --> SKIP4["跳过 css-loader.normal()"]

    BAIL --> BACK["pitch 返回值传给上一个 loader 的 normal<br/>style-loader.normal('处理后的内容')"]

    BACK --> DONE["最终输出"]

    subgraph STYLE_LOADER_SECRET ["style-loader.pitch 返回的代码"]
        CODE["var css = require('css-loader!sass-loader!app.scss');<br/>var style = document.createElement('style');<br/>style.textContent = css;<br/>document.head.appendChild(style);<br/>-------<br/>用 remainingRequest 构造 inline require<br/>让 webpack 帮忙走完剩余 loader 链"]
    end

    CP -.-> STYLE_LOADER_SECRET

    style START fill:#4a90d9,color:#fff
    style BAIL fill:#f8d7da,stroke:#dc3545
    style SKIP1 fill:#ccc,stroke:#999,color:#999
    style SKIP2 fill:#ccc,stroke:#999,color:#999
    style SKIP3 fill:#ccc,stroke:#999,color:#999
    style SKIP4 fill:#ccc,stroke:#999,color:#999
    style STYLE_LOADER_SECRET fill:#fff3cd,stroke:#ffc107
```

## 3. Async Loader (this.async)

```mermaid
flowchart TD
    ENTER["babel-loader.normal(source)"]

    ENTER --> ASYNC["const callback = this.async()<br/>标记为异步 Loader"]

    ASYNC --> PROCESS["异步处理<br/>(Babel 编译 / 读文件 / 网络请求)"]

    PROCESS --> DONE["callback(null, transformedCode)<br/>通知完成, 传递结果"]

    DONE --> NEXT["LoaderRunner 继续<br/>执行下一个 loader"]

    style ENTER fill:#4a90d9,color:#fff
    style ASYNC fill:#f5a623,color:#fff
    style DONE fill:#d4edda,stroke:#28a745
```

## 4. this.data 跨阶段共享

```mermaid
flowchart LR
    PITCH["comment-loader.pitch()<br/>this.data.timestamp = Date.now()"]
    NORMAL["comment-loader.normal(source)<br/>读取 this.data.timestamp<br/>追加注释到代码末尾"]

    PITCH -->|"this.data 是同一个对象"| NORMAL

    style PITCH fill:#f5a623,color:#fff
    style NORMAL fill:#4a90d9,color:#fff
```

## 5. 面试速查: Loader vs Plugin

```mermaid
flowchart LR
    subgraph LOADER_BOX ["Loader"]
        L1["是什么: 函数, 转换文件内容"]
        L2["输入: 源代码字符串"]
        L3["输出: 转换后的代码字符串"]
        L4["配置: module.rules"]
        L5["执行: Normal 右→左, Pitch 左→右"]
        L6["例子: babel-loader, css-loader"]
    end

    subgraph PLUGIN_BOX ["Plugin"]
        P1["是什么: 类, 有 apply 方法"]
        P2["输入: compiler 实例"]
        P3["输出: 通过钩子修改编译过程"]
        P4["配置: plugins 数组"]
        P5["执行: 在各生命周期钩子中"]
        P6["例子: HtmlWebpackPlugin, ManifestPlugin"]
    end

    style LOADER_BOX fill:#e8f4fd,stroke:#4a90d9
    style PLUGIN_BOX fill:#d4edda,stroke:#28a745
```

**面试要点:**
- Loader 执行顺序: **Pitch 从左到右, Normal 从右到左** (和函数 compose 一致)
- Pitch 熔断是 style-loader 能工作的关键 — pitch 返回值直接跳过后续所有步骤
- `this.async()` 让 Loader 支持异步操作 (babel 编译、图片压缩等)
- `this.data` 在 pitch 和 normal 之间共享数据
- Loader 只做"文件内容转换", Plugin 能介入整个编译生命周期
