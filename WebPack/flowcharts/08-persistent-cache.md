# 持久化缓存 — 面试流程图

> 对应文件: `persistent-cache-demo.js`

## 1. 为什么需要持久化缓存?

```mermaid
flowchart LR
    subgraph WP4 ["webpack 4"]
        W4["只有内存缓存<br/>关闭进程 → 缓存消失<br/>重启 → 从零编译<br/>大项目首次: 30-60s"]
    end

    subgraph WP5 ["webpack 5"]
        W5["filesystem cache<br/>编译结果持久化到磁盘<br/>二次启动: 2-3s"]
    end

    WP4 -->|"cache: { type: 'filesystem' }"| WP5

    style WP4 fill:#f8d7da,stroke:#dc3545
    style WP5 fill:#d4edda,stroke:#28a745
```

## 2. 核心问题: 如何判断缓存有效?

```mermaid
flowchart TD
    Q["缓存是否有效?<br/>不能简单看文件有没有变"]

    Q --> ETAG["ETag = hash(<br/>  文件内容 +<br/>  loader 配置 +<br/>  webpack 版本 +<br/>  Node.js 版本 +<br/>  buildDependencies +<br/>  resolve 配置<br/>)"]

    ETAG --> COMPARE{"新 ETag === 缓存中的 ETag?"}

    COMPARE -->|"相同"| HIT["缓存命中<br/>跳过编译, 直接用缓存"]

    COMPARE -->|"不同"| MISS["缓存失效<br/>重新编译, 更新缓存"]

    style Q fill:#4a90d9,color:#fff
    style ETAG fill:#f5a623,color:#fff
    style HIT fill:#d4edda,stroke:#28a745
    style MISS fill:#f8d7da,stroke:#dc3545
```

## 3. 带缓存的编译流程

```mermaid
flowchart TD
    START["buildModule(moduleId)"]

    START --> READ["读取文件内容"]

    READ --> CALC["计算 ETag<br/>hash(内容 + loader配置 + 依赖)"]

    CALC --> QUERY{"查询磁盘缓存<br/>cache.get(moduleId, etag)"}

    QUERY -->|"HIT 命中"| USE_CACHE["直接使用缓存结果<br/>跳过 AST 解析 / 遍历 / 生成<br/>-------<br/>巨大的性能提升!<br/>Babel 转换是编译耗时大户"]

    QUERY -->|"MISS 未命中"| COMPILE["正常编译<br/>AST 解析 → 遍历 → 生成代码"]

    COMPILE --> SAVE["写入缓存<br/>cache.set(moduleId, etag, result)"]

    SAVE --> PERSIST["持久化到磁盘<br/>cache.save()"]

    USE_CACHE --> DEPS["递归处理依赖<br/>(依赖可能缓存失效)"]
    PERSIST --> DEPS

    style START fill:#4a90d9,color:#fff
    style QUERY fill:#f5a623,color:#fff
    style USE_CACHE fill:#d4edda,stroke:#28a745
    style COMPILE fill:#f8d7da,stroke:#dc3545
```

## 4. 缓存失效场景演示

```mermaid
flowchart TD
    subgraph RUN1 ["第 1 次编译: 缓存为空"]
        R1_1["index.js → MISS → 编译"]
        R1_2["greeting.js → MISS → 编译"]
        R1_3["helper.js → MISS → 编译"]
        R1_4["utils.js → MISS → 编译"]
    end

    subgraph RUN2 ["第 2 次编译: 文件未修改"]
        R2_1["index.js → HIT"]
        R2_2["greeting.js → HIT"]
        R2_3["helper.js → HIT"]
        R2_4["utils.js → HIT"]
    end

    subgraph RUN3 ["第 3 次编译: 修改 helper.js"]
        R3_1["index.js → HIT (自身没变)"]
        R3_2["greeting.js → HIT (自身没变)"]
        R3_3["helper.js → MISS (内容变了, ETag 不同)"]
        R3_4["utils.js → HIT"]
    end

    subgraph RUN4 ["第 4 次编译: 修改 loader 配置"]
        R4_1["index.js → MISS"]
        R4_2["greeting.js → MISS"]
        R4_3["helper.js → MISS"]
        R4_4["utils.js → MISS"]
        R4_NOTE["loader 配置变了<br/>→ 所有模块 ETag 都变了<br/>→ 全部重新编译"]
    end

    RUN1 --> RUN2 --> RUN3 --> RUN4

    style RUN1 fill:#f8d7da,stroke:#dc3545
    style RUN2 fill:#d4edda,stroke:#28a745
    style RUN3 fill:#fff3cd,stroke:#ffc107
    style RUN4 fill:#f8d7da,stroke:#dc3545
```

## 5. webpack 5 缓存配置

```mermaid
flowchart TD
    CONFIG["webpack.config.js"]

    CONFIG --> CACHE["cache: {<br/>  type: 'filesystem',<br/>  buildDependencies: {<br/>    config: [__filename]<br/>  }<br/>}"]

    CACHE --> DIR["缓存目录:<br/>node_modules/.cache/webpack/<br/>├── default-development/<br/>│   ├── 0.pack<br/>│   └── index.pack<br/>└── default-production/"]

    CACHE --> INVALIDATE["失效条件"]

    INVALIDATE --> I1["源文件内容变化 → 对应模块失效"]
    INVALIDATE --> I2["loader 配置变化 → 所有模块失效"]
    INVALIDATE --> I3["webpack 版本升级 → 全部失效"]
    INVALIDATE --> I4["buildDependencies 变化 → 全部失效<br/>(webpack.config.js 改了)"]
    INVALIDATE --> I5["手动删除 .cache → 全部失效"]

    style CONFIG fill:#4a90d9,color:#fff
    style CACHE fill:#f5a623,color:#fff
    style INVALIDATE fill:#f8d7da,stroke:#dc3545
```

**面试要点:**
- webpack 5 引入 `cache: { type: 'filesystem' }`, 二次启动从 30s 降到 2-3s
- 缓存有效性靠 **ETag** 判断, ETag = hash(文件内容 + 配置 + 版本 + ...)
- `buildDependencies.config` 指向 webpack.config.js, 配置变了就清全部缓存
- 真实 webpack 还有: 二进制序列化(比 JSON 快 10x)、分包存储、惰性反序列化、内存+磁盘两级缓存
