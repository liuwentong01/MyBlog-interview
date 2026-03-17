# Tapable 钩子系统 — 面试流程图

> 对应文件: `tapable-demo.js`

## 1. 全局概览: 7 种 Hook 类型

```mermaid
flowchart TD
    BASE["Hook 基类<br/>_argNames[] / _taps[]<br/>tap() / tapAsync() / tapPromise()"]

    BASE --> SYNC_GROUP["同步 Hook<br/>(只能用 tap 注册)"]
    BASE --> ASYNC_GROUP["异步 Hook<br/>(tap/tapAsync/tapPromise 混用)"]

    SYNC_GROUP --> SH["SyncHook<br/>依次执行, 忽略返回值"]
    SYNC_GROUP --> SBH["SyncBailHook<br/>返回非 undefined 就中断"]
    SYNC_GROUP --> SWH["SyncWaterfallHook<br/>返回值传给下一个"]
    SYNC_GROUP --> SLH["SyncLoopHook<br/>返回非 undefined 从头重来"]

    ASYNC_GROUP --> ASH["AsyncSeriesHook<br/>异步串行"]
    ASYNC_GROUP --> ASBH["AsyncSeriesBailHook<br/>异步串行 + 熔断"]
    ASYNC_GROUP --> APH["AsyncParallelHook<br/>异步并行 (Promise.all)"]

    SH -.- USE_SH["compiler.hooks.run<br/>compiler.hooks.done"]
    SBH -.- USE_SBH["compiler.hooks.shouldEmit"]
    SWH -.- USE_SWH["compilation.hooks.assetPath"]
    ASH -.- USE_ASH["compiler.hooks.emit"]
    APH -.- USE_APH["compiler.hooks.make"]

    style BASE fill:#4a90d9,color:#fff
    style SYNC_GROUP fill:#f5a623,color:#fff
    style ASYNC_GROUP fill:#f5a623,color:#fff
```

## 2. SyncHook — 最基础的发布订阅

```mermaid
flowchart LR
    CALL["hook.call('webpack')"] --> A["PluginA(name)<br/>console.log('Hello webpack')"]
    A --> B["PluginB(name)<br/>console.log('Hi webpack')"]
    B --> DONE["全部执行完毕<br/>返回值被忽略"]

    style CALL fill:#4a90d9,color:#fff
    style DONE fill:#d4edda,stroke:#28a745
```

## 3. SyncBailHook — 熔断机制

```mermaid
flowchart TD
    CALL["hook.call(compilation)"] --> A["CheckSize()"]
    A -->|"return undefined<br/>(不中断)"| B["CheckError()"]
    B -->|"return false<br/>(非 undefined, 中断!)"| BAIL["立即返回 false<br/>后续回调不执行"]
    B -.->|"不会到达"| C["NeverReached()"]

    style CALL fill:#4a90d9,color:#fff
    style BAIL fill:#f8d7da,stroke:#dc3545
    style C fill:#ccc,stroke:#999,color:#999
```

**面试关键**: null / false / 0 都算"有返回值", 只有 undefined 才不中断

## 4. SyncWaterfallHook — 瀑布流 (链式传值)

```mermaid
flowchart LR
    CALL["hook.call(<br/>'[name].[hash].[ext]')"]
    CALL --> A["ReplaceName<br/>'[name].[hash].[ext]'<br/>→ 'main.[hash].[ext]'"]
    A -->|"return 'main.[hash].[ext]'"| B["ReplaceHash<br/>'main.[hash].[ext]'<br/>→ 'main.a1b2c3.[ext]'"]
    B -->|"return 'main.a1b2c3.[ext]'"| C["ReplaceExt<br/>'main.a1b2c3.[ext]'<br/>→ 'main.a1b2c3.js'"]
    C --> RESULT["最终: 'main.a1b2c3.js'"]

    style CALL fill:#4a90d9,color:#fff
    style RESULT fill:#d4edda,stroke:#28a745
```

**面试关键**: 上一个回调的返回值作为下一个回调的第一个参数; 如果返回 undefined 则保持当前值

## 5. SyncLoopHook — 循环直到稳定

```mermaid
flowchart TD
    START["hook.call()"] --> LOOP_START["从第一个回调开始"]

    LOOP_START --> A{"LooperA()"}
    A -->|"return true<br/>(非 undefined)"| LOOP_START
    A -->|"return undefined<br/>(准备好了)"| B{"LooperB()"}
    B -->|"return true<br/>(非 undefined)"| LOOP_START
    B -->|"return undefined<br/>(准备好了)"| DONE["所有回调都返回 undefined<br/>循环结束"]

    style START fill:#4a90d9,color:#fff
    style LOOP_START fill:#f5a623,color:#fff
    style DONE fill:#d4edda,stroke:#28a745
```

## 6. AsyncSeriesHook — 异步串行 (三种注册方式混用)

```mermaid
flowchart TD
    CALL["hook.callAsync(...args, finalCallback)<br/>或 await hook.promise(...args)"]

    CALL --> S["SyncPlugin (tap 注册)<br/>同步执行, 然后 next()"]
    S --> W["WriteFile (tapAsync 注册)<br/>fn(...args, callback)<br/>异步完成后调用 callback()"]
    W --> U["Upload (tapPromise 注册)<br/>fn(...args) 返回 Promise<br/>resolve 后 next()"]
    U --> DONE["finalCallback()<br/>全部完成"]

    style CALL fill:#4a90d9,color:#fff
    style S fill:#e8f4fd,stroke:#4a90d9
    style W fill:#fff3cd,stroke:#ffc107
    style U fill:#f8d7da,stroke:#dc3545
    style DONE fill:#d4edda,stroke:#28a745
```

## 7. webpack Compiler 中 Hook 的实际编排

```mermaid
flowchart TD
    RUN["compiler.run()"]

    RUN --> H_RUN["hooks.run.call()<br/>SyncHook<br/>通知: 编译开始"]

    H_RUN --> H_SHOULD{"hooks.shouldEmit.call(compilation)<br/>SyncBailHook<br/>检查: 是否应该输出?"}

    H_SHOULD -->|"return false"| SKIP["跳过输出"]
    H_SHOULD -->|"return undefined (不中断)"| H_ASSET["hooks.assetPath.call(template, data)<br/>SyncWaterfallHook<br/>链式处理: [name].[hash].js → main.abc123.js"]

    H_ASSET --> H_EMIT["await hooks.emit.promise(assets)<br/>AsyncSeriesHook<br/>异步串行: 多个插件按顺序写文件"]

    H_EMIT --> H_DONE["hooks.done.call(stats)<br/>SyncHook<br/>通知: 编译完成"]

    style RUN fill:#4a90d9,color:#fff
    style H_SHOULD fill:#f5a623,color:#fff
    style H_EMIT fill:#f8d7da,stroke:#dc3545
    style H_DONE fill:#d4edda,stroke:#28a745
```

**面试要点:**
- Tapable 是 webpack 的核心依赖, webpack 内部有 200+ 个钩子
- 所有 Plugin 通过 `hook.tap()` 注册, webpack 在合适时机 `hook.call()` 触发
- Sync Hook 只能 `tap()`; Async Hook 可以 `tap() + tapAsync() + tapPromise()` 混用
- 钩子类型决定了执行策略(串行/并行/熔断/瀑布/循环)
