# SplitChunksPlugin (分包策略) — 面试流程图

> 对应文件: `split-chunks-demo.js`

## 1. 为什么需要分包？

```mermaid
flowchart TD
    subgraph BEFORE ["不分包"]
        B1["pageA.js<br/>lodash(500KB) + utils(15KB) + compA(25KB)<br/>总计: 540KB"]
        B2["pageB.js<br/>lodash(500KB) + utils(15KB) + compB(20KB)<br/>总计: 535KB"]
        B3["总下载: 1075KB<br/>lodash 重复打包了!"]
    end

    subgraph AFTER ["分包后"]
        A1["pageA.js: 30KB<br/>(compA + 入口)"]
        A2["pageB.js: 24KB<br/>(compB + 入口)"]
        A3["vendors.js: 500KB<br/>(lodash，共享)"]
        A4["common.js: 15KB<br/>(utils，共享)"]
        A5["总下载: 569KB<br/>节省 506KB"]
    end

    BEFORE -->|"SplitChunksPlugin"| AFTER

    style BEFORE fill:#f8d7da,stroke:#dc3545
    style AFTER fill:#d4edda,stroke:#28a745
```

## 2. 与 Code Splitting (import()) 的区别

```mermaid
flowchart TD
    CS["代码分割 (Code Splitting)"]

    CS --> MANUAL["手动分割: import()<br/>开发者决定在哪里拆<br/>-------<br/>import('./lazy')<br/>→ 创建异步 chunk<br/>→ 运行时按需加载"]

    CS --> AUTO["自动分割: SplitChunksPlugin<br/>webpack 根据策略自动提取<br/>-------<br/>多 chunk 共享的依赖<br/>→ 自动提取到公共 chunk<br/>→ 避免重复打包"]

    MANUAL --> BOTH["两者互补:<br/>import() 决定'在哪里拆'<br/>SplitChunks 决定'怎么优化拆出来的 chunk'"]

    style CS fill:#4a90d9,color:#fff
    style MANUAL fill:#e8f4fd,stroke:#4a90d9
    style AUTO fill:#fff3cd,stroke:#ffc107
    style BOTH fill:#d4edda,stroke:#28a745
```

## 3. 核心配置项

```mermaid
flowchart TD
    CONFIG["splitChunks 配置"]

    CONFIG --> CHUNKS["chunks<br/>'all' → 同步+异步都优化 (推荐)<br/>'async' → 只优化异步 (默认)<br/>'initial' → 只优化同步"]

    CONFIG --> MINSIZE["minSize: 20000 (20KB)<br/>被提取的模块最小体积<br/>太小不值得多一次 HTTP 请求"]

    CONFIG --> MINCHUNKS["minChunks: 1<br/>最少被几个 chunk 引用才提取<br/>通常 vendor 设 1，common 设 2"]

    CONFIG --> MAXREQ["maxAsyncRequests: 30<br/>maxInitialRequests: 30<br/>控制并行请求数上限<br/>防止拆得太碎"]

    CONFIG --> CG["cacheGroups<br/>分组规则 (核心!)"]

    CG --> VENDORS["vendors: {<br/>  test: /node_modules/<br/>  priority: -10<br/>  name: 'vendors'<br/>}<br/>提取第三方依赖"]

    CG --> COMMON["common: {<br/>  minChunks: 2<br/>  priority: -20<br/>  reuseExistingChunk: true<br/>}<br/>提取公共业务代码"]

    style CONFIG fill:#4a90d9,color:#fff
    style CHUNKS fill:#f5a623,color:#fff
    style CG fill:#f5a623,color:#fff
    style VENDORS fill:#e8f4fd,stroke:#4a90d9
    style COMMON fill:#fff3cd,stroke:#ffc107
```

## 4. SplitChunks 决策流程

```mermaid
flowchart TD
    START["遍历所有模块"]

    START --> ENTRY{是入口模块?}
    ENTRY -->|"是"| SKIP1["SKIP: 入口不能被提取"]

    ENTRY -->|"否"| MATCH["按 priority 高→低<br/>依次匹配 cacheGroup"]

    MATCH --> TEST{test 条件匹配?}
    TEST -->|"不匹配"| NEXT["尝试下一个 cacheGroup"]
    NEXT --> TEST

    TEST -->|"匹配"| MINC{minChunks 满足?<br/>被引用次数 >= 阈值?}
    MINC -->|"否"| SKIP2["SKIP: 引用次数不够"]

    MINC -->|"是"| MINS{minSize 满足?<br/>模块体积 >= 阈值?}
    MINS -->|"否"| SKIP3["SKIP: 体积太小"]

    MINS -->|"是"| MAXR{maxRequests 满足?<br/>并行请求数未超限?}
    MAXR -->|"否"| SKIP4["SKIP: 请求数超限"]

    MAXR -->|"是"| SPLIT["SPLIT!<br/>从原 chunk 移到新 chunk<br/>命名: cacheGroup.name"]

    style START fill:#4a90d9,color:#fff
    style MATCH fill:#f5a623,color:#fff
    style SPLIT fill:#d4edda,stroke:#28a745
    style SKIP1 fill:#f8d7da,stroke:#dc3545
    style SKIP2 fill:#f8d7da,stroke:#dc3545
    style SKIP3 fill:#f8d7da,stroke:#dc3545
```

## 5. 完整示例决策过程

```mermaid
flowchart TD
    subgraph MODULES ["所有模块"]
        M1["lodash (500KB)<br/>来自 node_modules<br/>被 pageA + pageB 引用"]
        M2["shared-utils (15KB)<br/>业务公共代码<br/>被 pageA + pageB 引用"]
        M3["componentA (25KB)<br/>只被 pageA 引用"]
        M4["componentB (20KB)<br/>只被 pageB 引用"]
    end

    M1 --> D1["匹配 vendors (priority:-10)<br/>test: /node_modules/ ✓<br/>minChunks: 1 ✓ (被引用2次)<br/>minSize: 0 ✓"]
    D1 --> R1["→ vendors.js (500KB)"]

    M2 --> D2["不匹配 vendors (不在 node_modules)<br/>匹配 common (priority:-20)<br/>minChunks: 2 ✓ (被引用2次)<br/>minSize: 10KB ✓ (15KB > 10KB)"]
    D2 --> R2["→ common.js (15KB)"]

    M3 --> D3["不匹配 vendors<br/>匹配 common? minChunks: 2 ✗<br/>(只被引用1次)"]
    D3 --> R3["→ 保留在 pageA.js"]

    M4 --> D4["同理，只被引用1次"]
    D4 --> R4["→ 保留在 pageB.js"]

    style M1 fill:#f5a623,color:#fff
    style M2 fill:#f5a623,color:#fff
    style R1 fill:#d4edda,stroke:#28a745
    style R2 fill:#d4edda,stroke:#28a745
    style R3 fill:#e8f4fd,stroke:#4a90d9
    style R4 fill:#e8f4fd,stroke:#4a90d9
```

## 6. 缓存优化策略

```mermaid
flowchart TD
    CACHE["分包的缓存优势"]

    CACHE --> VENDOR["vendors.js (lodash 等)<br/>几乎不变 → contenthash 长期不变<br/>→ 浏览器长期缓存<br/>用户再次访问: 0 下载"]

    CACHE --> COMM["common.js (公共业务代码)<br/>偶尔变化 → contenthash 中频变化<br/>→ 中期缓存"]

    CACHE --> BIZ["pageA/B.js (业务代码)<br/>频繁变化 → contenthash 每次变<br/>→ 每次都下载<br/>但体积很小!"]

    CACHE --> EFFECT["效果:<br/>用户访问 pageA 后再访问 pageB<br/>vendors.js + common.js 已缓存<br/>只需下载 pageB.js (24KB)<br/>而不是整个 535KB"]

    style CACHE fill:#4a90d9,color:#fff
    style VENDOR fill:#d4edda,stroke:#28a745
    style COMM fill:#fff3cd,stroke:#ffc107
    style BIZ fill:#f8d7da,stroke:#dc3545
    style EFFECT fill:#d4edda,stroke:#28a745
```

## 7. 常见面试问题: chunks 三个值的区别

```mermaid
flowchart TD
    subgraph ASYNC_ONLY ["chunks: 'async' (默认)"]
        AO1["只优化异步 chunk (import())<br/>同步共享的依赖不提取"]
        AO2["适合: 单入口 SPA<br/>因为同步只有一个 chunk"]
    end

    subgraph INITIAL_ONLY ["chunks: 'initial'"]
        IO1["只优化同步 chunk (入口直接依赖)<br/>异步 chunk 之间的共享不管"]
        IO2["适合: 多页应用<br/>但异步部分可能重复"]
    end

    subgraph ALL ["chunks: 'all' (推荐)"]
        AL1["同步 + 异步都优化<br/>最全面的分包策略"]
        AL2["适合: 绝大多数项目<br/>webpack 官方推荐"]
    end

    style ASYNC_ONLY fill:#f8d7da,stroke:#dc3545
    style INITIAL_ONLY fill:#fff3cd,stroke:#ffc107
    style ALL fill:#d4edda,stroke:#28a745
```

**面试要点:**
- SplitChunksPlugin 解决"多 chunk 共享依赖重复打包"问题，自动提取公共代码
- 与 `import()` 互补：import() 决定拆分点，SplitChunks 优化拆出来的 chunk
- `chunks: 'all'` 是推荐配置，同步+异步都优化
- cacheGroups 是核心：vendors 提取 node_modules，common 提取公共业务代码
- priority 决定匹配优先级，高优先级先匹配
- 分包的本质是**缓存优化**：变化频率不同的代码分开打包 → 浏览器缓存命中率更高
- minSize/minChunks 是平衡点：太小的模块不值得多一次 HTTP 请求
