# Code Splitting (代码分割) — 面试流程图

> 对应文件: `code-splitting-demo.js` (编译时) + `async-loader-demo.js` (运行时)

## 1. 编译时: 如何拆分 chunk

```mermaid
flowchart TD
    SOURCE["源码: index.js<br/>const greeting = require('./greeting')  ← 同步<br/>import('./lazy-module').then(m => ...)   ← 动态"]

    SOURCE --> PARSE["遍历入口 AST<br/>区分两类依赖"]

    PARSE --> SYNC["识别 require() → 同步依赖<br/>归入主 chunk"]
    PARSE --> DYNAMIC["识别 import() → 动态依赖<br/>callee.type === 'Import'<br/>创建新的 async chunk"]

    DYNAMIC --> REPLACE["AST 替换:<br/>import('./lazy-module')<br/>↓<br/>require.e('chunk-lazy-module')<br/>.then(require.bind(require, './src/lazy-module.js'))"]

    SYNC --> MAIN_CHUNK["主 chunk (main.js)<br/>包含:<br/>- 入口模块 + 所有同步依赖<br/>- require 运行时<br/>- JSONP 异步加载运行时"]

    REPLACE --> ASYNC_CHUNK["异步 chunk (chunk-lazy-module.js)<br/>包含:<br/>- lazy-module.js + 其同步依赖 lazy-helper.js<br/>- JSONP 格式包裹"]

    subgraph OUTPUT ["最终产出"]
        O1["main.js<br/>入口 + greeting.js + 异步运行时"]
        O2["chunk-lazy-module.js<br/>lazy-module.js + lazy-helper.js"]
        O3["chunk-lazy-utils.js<br/>lazy-utils.js"]
    end

    MAIN_CHUNK --> O1
    ASYNC_CHUNK --> O2
    ASYNC_CHUNK --> O3

    style SOURCE fill:#4a90d9,color:#fff
    style REPLACE fill:#f5a623,color:#fff
    style OUTPUT fill:#d4edda,stroke:#28a745
```

## 2. 异步 chunk 的 JSONP 格式

```mermaid
flowchart TD
    FILE["chunk-lazy-module.js 文件内容"]

    FILE --> CODE["(self.webpackChunk = self.webpackChunk || []).push([<br/>  ['chunk-lazy-module'],<br/>  {<br/>    './src/lazy-module.js': (module, exports, require) => {<br/>      // 模块代码<br/>    },<br/>    './src/lazy-helper.js': (module, exports, require) => {<br/>      // 模块代码<br/>    }<br/>  }<br/>])"]

    CODE --> WHY["为什么用 JSONP (push) 而非 fetch?"]

    WHY --> R1["1. script 天然跨域, 不需要 CORS"]
    WHY --> R2["2. 不触发 CSP 对 eval 的限制"]
    WHY --> R3["3. push 被劫持为 webpackJsonpCallback<br/>   天然实现加载完成回调"]

    style FILE fill:#4a90d9,color:#fff
    style WHY fill:#f5a623,color:#fff
```

## 3. 运行时: 完整加载链路

```mermaid
flowchart TD
    TRIGGER["用户点击按钮<br/>触发 import('./lazy')"]

    TRIGGER --> RE["require.e('chunk-lazy-module')<br/>遍历 require.f 策略, 收集 promises"]

    RE --> FJ["require.f.j('chunk-lazy-module', promises)<br/>检查 installedChunks → undefined (未加载)"]

    FJ --> PROMISE["创建 Promise<br/>installedChunks['chunk-lazy-module']<br/>= [resolve, reject, promise]"]

    PROMISE --> SCRIPT["require.l(url, done)<br/>创建 script 标签<br/>src = 'chunk-lazy-module.js'<br/>插入 document.head"]

    SCRIPT --> DOWNLOAD["浏览器下载 chunk-lazy-module.js"]

    DOWNLOAD --> EXEC["脚本执行<br/>self.webpackChunk.push([...])"]

    EXEC --> JSONP["webpackJsonpCallback<br/>1. 合并 modules<br/>2. resolve Promise<br/>3. 设置 installedChunks = 0"]

    JSONP --> ALL["Promise.all 完成"]

    ALL --> SYNC["require('./src/lazy-module.js')<br/>同步执行模块, 返回 exports"]

    SYNC --> USE[".then(module => module.hello())<br/>使用模块"]

    style TRIGGER fill:#4a90d9,color:#fff
    style JSONP fill:#f8d7da,stroke:#dc3545
    style ALL fill:#d4edda,stroke:#28a745
    style USE fill:#d4edda,stroke:#28a745
```

## 4. 编译时 vs 运行时 对照

```mermaid
flowchart LR
    subgraph COMPILE ["编译时 (code-splitting-demo.js)"]
        C1["识别 import() 调用"]
        C2["拆分独立 chunk"]
        C3["替换 AST:<br/>import() → require.e().then()"]
        C4["注入 JSONP 运行时"]
        C1 --> C2 --> C3 --> C4
    end

    subgraph RUNTIME ["运行时 (async-loader-demo.js)"]
        R1["require.e() 发起加载"]
        R2["require.f.j 创建 script"]
        R3["webpackJsonpCallback 合并模块"]
        R4["require() 同步执行"]
        R1 --> R2 --> R3 --> R4
    end

    C4 -.->|"生成的代码<br/>在浏览器中执行"| R1

    style COMPILE fill:#e8f4fd,stroke:#4a90d9
    style RUNTIME fill:#fff3cd,stroke:#ffc107
```

**面试要点:**
- Code Splitting = **编译时拆 chunk** + **运行时 JSONP 加载**
- `import()` 编译后变成 `require.e("chunkName").then(require.bind(require, moduleId))`
- 异步 chunk 用 JSONP 格式包裹: `self.webpackChunk.push([chunkIds, modules])`
- 异步 chunk 中的同步依赖会被打进同一个 chunk (如 lazy-module + lazy-helper)
