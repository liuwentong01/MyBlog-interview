# mini-webpack 完整打包器 — 面试流程图

> 对应文件: `mini-webpack/webpack.js` + `debugger.js` + `webpack.config.js`

## 1. 整体运行流程 (全景)

```mermaid
flowchart TD
    START["webpack(config)"]

    START --> NEW_COMPILER["new Compiler(config)<br/>创建单例, 初始化 hooks"]

    NEW_COMPILER --> PLUGINS["plugin.apply(compiler) x N<br/>遍历所有 Plugin<br/>注入钩子回调"]

    PLUGINS --> RETURN["return compiler"]

    RETURN --> RUN["compiler.run(callback)"]

    RUN --> H_RUN["hooks.run.call()<br/>触发 '编译开始' 钩子"]

    H_RUN --> COMPILE["compiler.compile(onCompiled)<br/>new Compilation(config)<br/>compilation.build(callback)"]

    subgraph BUILD_PHASE ["compilation.build()"]
        B1["统一 entry 格式<br/>字符串 → {main: './src/index.js'}"]
        B2["遍历每个入口<br/>buildModule(entryName, entryPath)"]
        B3["组装 chunk<br/>一个入口 → 一个 chunk"]
        B4["生成 assets<br/>chunk → 可运行的 bundle 字符串<br/>支持 [name] [hash] [contenthash]"]
        B1 --> B2 --> B3 --> B4
    end

    COMPILE --> B1

    B4 --> H_EMIT["hooks.emit.call(assets)<br/>Plugin 可修改/追加产出文件"]

    H_EMIT --> WRITE["写文件到磁盘<br/>fs.writeFileSync"]

    WRITE --> H_AFTER["hooks.afterEmit.call(assets)"]

    H_AFTER --> CB["callback(null, stats)"]

    CB --> WATCH["fs.watch(所有涉及文件)<br/>文件变化 → 重新 compile"]

    WATCH --> H_DONE["hooks.done.call()<br/>触发 '编译完成' 钩子"]

    style START fill:#4a90d9,color:#fff
    style COMPILE fill:#f5a623,color:#fff
    style H_EMIT fill:#f8d7da,stroke:#dc3545
    style H_DONE fill:#d4edda,stroke:#28a745
```

## 2. buildModule 核心 8 步 (重点!)

```mermaid
flowchart TD
    ENTRY["buildModule(name, modulePath)"]

    ENTRY --> S1{"Step 1: 循环依赖保护<br/>modules 中已存在该模块?"}

    S1 -->|"已存在"| S1_HIT["追加 chunk 名称<br/>直接返回 (不重复编译)"]

    S1 -->|"不存在"| S2["Step 2: 读取文件<br/>fs.readFileSync(modulePath, 'utf8')"]

    S2 --> S3["Step 3: 创建 module 对象<br/>{ id, names, dependencies, _source }<br/>立即 push 到 this.modules<br/>-------<br/>关键: 先占位!<br/>解决循环依赖: A→B→A 时<br/>B 再 build A 发现已存在, 不递归"]

    S3 --> S4["Step 4: 应用 Loader (从右到左)<br/>use: [A, B, C]<br/>→ A(B(C(source)))<br/>reduceRight 实现"]

    S4 --> S5["Step 5: 解析 AST<br/>@babel/parser<br/>parse(sourceCode, { sourceType: 'module' })"]

    S5 --> S6["Step 6: 遍历 AST, 改写 require 路径<br/>@babel/traverse<br/>require('./greeting')<br/>→ require('./src/greeting.js')<br/>-------<br/>同时收集 dependencies"]

    S6 --> S7["Step 7: 重新生成代码<br/>@babel/generator<br/>AST → 字符串"]

    S7 --> S8["Step 8: 递归编译所有依赖<br/>dependencies.forEach(dep =><br/>  this.buildModule(name, dep.path)<br/>)"]

    S8 --> DONE["返回 module 对象"]

    style ENTRY fill:#4a90d9,color:#fff
    style S3 fill:#f8d7da,stroke:#dc3545
    style S6 fill:#f5a623,color:#fff
    style S8 fill:#f5a623,color:#fff
```

## 3. 循环依赖如何解决 (编译时 + 运行时)

```mermaid
flowchart TD
    subgraph COMPILE_TIME ["编译时 (buildModule)"]
        CT1["buildModule(A)<br/>→ 创建 module A, push 到 modules"]
        CT2["发现 A 依赖 B<br/>→ buildModule(B)"]
        CT3["发现 B 依赖 A<br/>→ buildModule(A)"]
        CT4["modules 中已有 A<br/>→ 直接返回, 不递归!"]

        CT1 --> CT2 --> CT3 --> CT4
    end

    subgraph RUNTIME ["运行时 (bundle 中的 require)"]
        RT1["require(A)<br/>→ 创建 module, 放入 cache"]
        RT2["A 的代码执行中调用 require(B)"]
        RT3["B 的代码执行中调用 require(A)"]
        RT4["cache 中已有 A<br/>→ 返回 A 当前的 exports<br/>(可能是部分完成的)"]

        RT1 --> RT2 --> RT3 --> RT4
    end

    CT4 -.-|"完全对应"| RT4

    style COMPILE_TIME fill:#e8f4fd,stroke:#4a90d9
    style RUNTIME fill:#fff3cd,stroke:#ffc107
    style CT4 fill:#d4edda,stroke:#28a745
    style RT4 fill:#d4edda,stroke:#28a745
```

## 4. Bundle 产物结构

```mermaid
flowchart TD
    BUNDLE["生成的 bundle.js (IIFE)"]

    BUNDLE --> MODULES["var modules = {<br/>  './src/greeting.js': (module, exports, require) => { ... },<br/>  './src/message.js': (module, exports, require) => { ... },<br/>  './src/index.js': (module, exports, require) => { ... }<br/>}"]

    BUNDLE --> CACHE["var cache = {}<br/>每个模块只执行一次"]

    BUNDLE --> REQUIRE["function require(moduleId) {<br/>  if (cache[moduleId]) return cache[moduleId].exports;<br/>  var module = cache[moduleId] = { exports: {} };<br/>  modules[moduleId](module, module.exports, require);<br/>  return module.exports;<br/>}"]

    BUNDLE --> ENTRY_CALL["require('./src/index.js')<br/>从入口开始执行"]

    style BUNDLE fill:#4a90d9,color:#fff
    style REQUIRE fill:#f5a623,color:#fff
    style ENTRY_CALL fill:#d4edda,stroke:#28a745
```

## 5. Plugin 系统

```mermaid
flowchart TD
    PLUGIN_DEF["Plugin 规范:<br/>必须有 apply(compiler) 方法"]

    PLUGIN_DEF --> REGISTER["在 apply 中注册钩子回调<br/>compiler.hooks.xxx.tap('Name', callback)"]

    REGISTER --> EXAMPLE1["WebpackRunPlugin<br/>hooks.run.tap → 打印编译开始"]
    REGISTER --> EXAMPLE2["WebpackDonePlugin<br/>hooks.done.tap → 打印编译完成"]
    REGISTER --> EXAMPLE3["ManifestPlugin<br/>hooks.emit.tap → 生成 manifest.json<br/>-------<br/>核心: 往 assets 里追加新文件<br/>Compiler 统一写入磁盘<br/>HtmlWebpackPlugin 同理"]

    style PLUGIN_DEF fill:#4a90d9,color:#fff
    style EXAMPLE3 fill:#f5a623,color:#fff
```

## 6. Compiler vs Compilation

```mermaid
flowchart LR
    subgraph COMPILER_BOX ["Compiler (单例)"]
        C1["整个生命周期只有一个"]
        C2["管理 hooks / options"]
        C3["驱动编译 + 写文件"]
        C4["管理 watch 模式"]
    end

    subgraph COMPILATION_BOX ["Compilation (每次编译)"]
        CO1["每次编译 new 一个"]
        CO2["独立的 modules / chunks / assets"]
        CO3["执行 buildModule + 组装 chunk"]
        CO4["watch 重编译 → 新 Compilation"]
    end

    COMPILER_BOX -->|"compiler.compile()"| COMPILATION_BOX

    style COMPILER_BOX fill:#e8f4fd,stroke:#4a90d9
    style COMPILATION_BOX fill:#fff3cd,stroke:#ffc107
```

**面试要点:**
- webpack 本质: 读配置 → 挂 Plugin → Compiler.run → Compilation.build → 写文件
- buildModule 8 步: 循环依赖保护 → 读文件 → 先占位 → Loader → AST 解析 → 改写路径 → 生成代码 → 递归依赖
- 循环依赖靠 "先占位再递归" 解决, 编译时和运行时策略完全对应
- Plugin 通过 `apply(compiler)` 注入钩子, emit 钩子可追加产出文件
- Compiler 是单例, Compilation 每次编译新建 (状态隔离)
