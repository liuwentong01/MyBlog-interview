# HMR 热模块替换 — 面试流程图

> 对应文件: `mini-devserver/dev-server.js`

## 1. 整体架构

```mermaid
flowchart TD
    subgraph SERVER_SIDE ["服务端"]
        SRC["源码文件<br/>src/*.js"]
        WATCHER["fs.watch<br/>文件监听"]
        COMPILER["编译器<br/>AST 分析 + 增量编译"]
        MEMFS["内存文件系统 (memoryFS)<br/>bundle.js / hot-update 文件"]
        HTTP["HTTP 服务器<br/>localhost:8080<br/>提供文件下载"]
        WS["WebSocket 服务<br/>推送 hash 通知"]
    end

    subgraph CLIENT_SIDE ["浏览器端"]
        BROWSER["浏览器客户端"]
        WS_CLIENT["WebSocket 客户端<br/>接收 hash + ok"]
        HMR_RT["HMR 运行时<br/>webpackHotUpdate"]
        REQUIRE["自定义 require<br/>+ module.hot API"]
    end

    SRC -->|"文件变化"| WATCHER
    WATCHER --> COMPILER
    COMPILER --> MEMFS
    MEMFS --> HTTP
    MEMFS --> WS
    WS -->|"推送消息"| WS_CLIENT
    HTTP -->|"提供文件"| BROWSER
    WS_CLIENT --> HMR_RT
    HMR_RT --> REQUIRE

    style SRC fill:#4a90d9,color:#fff
    style MEMFS fill:#f5a623,color:#fff
    style HMR_RT fill:#f8d7da,stroke:#dc3545
```

## 2. HMR 完整流程 (10 步)

```mermaid
flowchart TD
    STEP1["1. 首次编译<br/>编译所有模块 → 生成 hash h1<br/>bundle 存入内存"]

    STEP2["2. 浏览器访问 localhost:8080<br/>HTTP 返回 index.html + bundle.js"]

    STEP3["3. bundle.js 中的 WS 客户端<br/>连接服务器, 收到初始 hash h1"]

    STEP4["4. 用户修改 src/name.js 并保存"]

    STEP5["5. fs.watch 检测到变化<br/>(200ms 防抖)"]

    STEP6["6. 增量编译该模块<br/>生成新 hash h2"]

    STEP7["7. WebSocket 推送给浏览器<br/>{type:'hash', hash:'h2'}<br/>{type:'ok'}"]

    STEP8["8. 浏览器用 lastHash=h1 请求<br/>GET /h1.hot-update.json<br/>→ 拿到变更的 chunk 列表"]

    STEP9["9. 浏览器加载<br/>script src='/main.h1.hot-update.js'<br/>→ 执行 webpackHotUpdate()"]

    STEP10["10. 替换模块 → 清缓存 → 执行 accept 回调<br/>页面局部更新, 状态不丢失"]

    STEP1 --> STEP2 --> STEP3
    STEP4 --> STEP5 --> STEP6 --> STEP7
    STEP7 --> STEP8 --> STEP9 --> STEP10

    style STEP1 fill:#4a90d9,color:#fff
    style STEP4 fill:#f5a623,color:#fff
    style STEP7 fill:#f5a623,color:#fff
    style STEP9 fill:#f8d7da,stroke:#dc3545
    style STEP10 fill:#d4edda,stroke:#28a745
```

## 3. 增量编译 (incrementalBuild)

```mermaid
flowchart TD
    CHANGE["文件变化: src/name.js"]

    CHANGE --> CHECK{"modules 中有这个文件?"}
    CHECK -->|"没有"| SKIP["跳过, 不在模块列表中"]
    CHECK -->|"有"| SAVE["保存旧 hash (oldHash)"]

    SAVE --> DELETE["delete modules[moduleId]<br/>删除旧模块记录"]

    DELETE --> REBUILD["buildModule(name, path)<br/>重新编译该模块<br/>-------<br/>已存在的其他模块会被<br/>循环依赖保护跳过 (不重复编译)"]

    REBUILD --> NEW_HASH["生成新 hash (newHash)"]

    NEW_HASH --> GEN_HOT["generateHotUpdate(oldHash, moduleId)<br/>生成两个文件存入 memoryFS"]

    GEN_HOT --> JSON_FILE["/{oldHash}.hot-update.json<br/>{ c: { main: true } }<br/>告诉浏览器哪些 chunk 变了"]

    GEN_HOT --> JS_FILE["/main.{oldHash}.hot-update.js<br/>self.webpackHotUpdate('main', {<br/>  './src/name.js': (module, exports, require) => {<br/>    module.exports = '新的值'<br/>  }<br/>})"]

    NEW_HASH --> GEN_BUNDLE["generateBundle()<br/>同时更新完整 bundle<br/>(供新连接/刷新使用)"]

    style CHANGE fill:#4a90d9,color:#fff
    style DELETE fill:#f8d7da,stroke:#dc3545
    style JSON_FILE fill:#fff3cd,stroke:#ffc107
    style JS_FILE fill:#fff3cd,stroke:#ffc107
```

## 4. 浏览器端 HMR 运行时

```mermaid
flowchart TD
    subgraph WS_FLOW ["WebSocket 客户端"]
        MSG["收到消息"]
        MSG -->|"type: hash"| HASH["lastHash = currentHash<br/>currentHash = msg.hash"]
        MSG -->|"type: ok"| OK{"lastHash 存在<br/>且 !== currentHash?"}
        OK -->|"是"| HOT_CHECK["触发 hotCheck(lastHash)"]
        OK -->|"否 (首次连接)"| NOOP["不触发热更新"]
    end

    subgraph HOT_CHECK_FLOW ["hotCheck 流程"]
        HC1["fetch /{lastHash}.hot-update.json<br/>获取变更 chunk 清单"]
        HC2["对每个变更 chunk:<br/>创建 script 标签<br/>src = /{chunkId}.{lastHash}.hot-update.js"]
        HC3["script 加载执行<br/>调用 self.webpackHotUpdate()"]

        HC1 --> HC2 --> HC3
    end

    HOT_CHECK --> HC1

    subgraph HOT_UPDATE_FLOW ["webpackHotUpdate 执行"]
        HU1["Step 1: 替换模块代码<br/>modules[moduleId] = newFactory"]
        HU2["Step 2: 删除缓存 (关键!)<br/>delete cache[moduleId]<br/>不删的话 require 返回旧值"]
        HU3{"Step 3: 有 accept 回调?"}
        HU4["执行 accept 回调<br/>回调中通常 re-require 该模块<br/>拿到新的导出值"]
        HU5["没有 accept 回调<br/>→ 无法局部更新<br/>→ window.location.reload()"]

        HU1 --> HU2 --> HU3
        HU3 -->|"有"| HU4
        HU3 -->|"没有"| HU5
    end

    HC3 --> HU1

    style MSG fill:#4a90d9,color:#fff
    style HU2 fill:#f8d7da,stroke:#dc3545
    style HU4 fill:#d4edda,stroke:#28a745
    style HU5 fill:#f8d7da,stroke:#dc3545
```

## 5. module.hot.accept 业务代码示例

```mermaid
flowchart TD
    CODE["业务代码 index.js"]

    CODE --> RENDER["function render() {<br/>  var name = require('./name');<br/>  var age = require('./age');<br/>  root.innerText = name + age;<br/>}"]

    RENDER --> ACCEPT1["module.hot.accept('./name', function() {<br/>  console.log('name 模块更新了');<br/>  render();  // 重新 require + 渲染<br/>})"]

    RENDER --> ACCEPT2["module.hot.accept('./age', function() {<br/>  console.log('age 模块更新了');<br/>  render();<br/>})"]

    ACCEPT1 --> EFFECT["效果:<br/>修改 name.js 保存 → 自动重新渲染<br/>输入框中的文字不丢失 (不是整页刷新)"]

    style CODE fill:#4a90d9,color:#fff
    style EFFECT fill:#d4edda,stroke:#28a745
```

## 6. 为什么用 script 标签加载 hot-update.js 而非 fetch?

```mermaid
flowchart TD
    Q["为什么不用 fetch?"]

    Q --> R1["1. 避免 eval(), 兼容 CSP<br/>fetch 回 JS 字符串必须 eval 执行<br/>script 标签走浏览器原生执行通道"]

    Q --> R2["2. 天然的回调机制<br/>脚本加载后自动调用<br/>self.webpackHotUpdate()<br/>不需要额外协调"]

    Q --> R3["3. 与 webpack 异步加载统一<br/>code splitting 也是 JSONP/script<br/>复用同一套机制"]

    style Q fill:#4a90d9,color:#fff
```

**面试要点:**
- HMR 核心流程: 文件变化 → 增量编译 → WS 推送 hash → 浏览器请求 json + js → 替换模块 → 执行回调
- 两次 HTTP 请求: 先请求 `.hot-update.json` (变更清单), 再加载 `.hot-update.js` (新代码)
- `delete cache[moduleId]` 是关键 — 不删缓存的话 require 返回的还是旧值
- 没有 `module.hot.accept` 回调 → 无法局部更新 → 只能整页刷新
- 用 script 标签而非 fetch: 兼容 CSP、天然回调、与 code splitting 统一
- 内存文件系统 (memoryFS): 避免频繁磁盘 IO, 提升开发编译速度
