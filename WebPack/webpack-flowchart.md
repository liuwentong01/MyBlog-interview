# WebPack 目录完整知识流程图

```mermaid
flowchart TD
    %% ====================================================================
    %% 顶层：WebPack 目录总览
    %% ====================================================================
    ROOT["WebPack 目录<br/>Webpack 核心原理完整实现"]

    ROOT --> RUNTIME["模块运行时<br/>3 个 demo 文件"]
    ROOT --> TAPABLE["Tapable 钩子系统<br/>tapable-demo.js"]
    ROOT --> LOADER["Loader 管线<br/>loader-pipeline-demo.js"]
    ROOT --> TREESHAKE["Tree Shaking<br/>tree-shaking-demo.js"]
    ROOT --> CODESPLIT["Code Splitting<br/>code-splitting-demo.js"]
    ROOT --> SOURCEMAP["Source Map<br/>source-map-demo.js"]
    ROOT --> CACHE["持久化缓存<br/>persistent-cache-demo.js"]
    ROOT --> MF["Module Federation<br/>module-federation-demo.js"]
    ROOT --> MINIWEBPACK["mini-webpack<br/>完整打包器实现"]
    ROOT --> MINIDEV["mini-devserver<br/>HMR 热更新实现"]

    %% ====================================================================
    %% A. 模块运行时 (3 个 loader demo)
    %% ====================================================================
    subgraph RUNTIME_SUB ["模块加载运行时"]
        direction TB

        subgraph CJS_SUB ["module-loader-demo.js<br/>CommonJS 模块加载"]
            CJS1["定义 modules 对象<br/>key=模块路径, value=工厂函数<br/>(module, exports, require) => { }"]
            CJS2["创建 cache 缓存对象"]
            CJS3["实现 require 函数"]
            CJS4["检查 cache 是否命中"]
            CJS5["命中: 直接返回<br/>cachedModule.exports"]
            CJS6["未命中: 创建 module 对象<br/>module = cache[path] = {exports:{}}"]
            CJS7["执行模块工厂函数<br/>modules[path](module, module.exports, require)"]
            CJS8["返回 module.exports"]
            CJS9["IIFE 入口<br/>require('./src/name.js')"]

            CJS1 --> CJS2 --> CJS3 --> CJS4
            CJS4 -->|命中| CJS5
            CJS4 -->|未命中| CJS6 --> CJS7 --> CJS8
            CJS3 --> CJS9
        end

        subgraph ESM_SUB ["esm-loader-demo.js<br/>ES Module 模块加载"]
            ESM1["modules 对象<br/>ESM 模块的工厂函数"]
            ESM2["require.setModuleTag(exports)<br/>设置 Symbol.toStringTag = 'Module'<br/>设置 __esModule = true"]
            ESM3["require.defineProperty(exports, definition)<br/>用 Object.defineProperty + getter<br/>实现 live binding 动态绑定"]
            ESM4["default 导出<br/>exports['default'] 通过 getter 访问"]
            ESM5["命名导出<br/>exports.age 通过 getter 访问"]

            ESM1 --> ESM2 --> ESM3
            ESM3 --> ESM4
            ESM3 --> ESM5
        end

        subgraph ASYNC_SUB ["async-loader-demo.js<br/>Webpack 5 异步加载运行时"]
            direction TB
            ASYNC_ENTRY["import('./test.js') 编译为<br/>require.e('src_test_js')<br/>.then(require.bind(require, './src/test.js'))"]

            ASYNC_E["require.e(chunkId)<br/>遍历 require.f 中所有策略<br/>收集 promises, Promise.all"]

            subgraph STRATEGIES ["require.f 策略注册表"]
                ASYNC_FJ["require.f.j<br/>JSONP 加载 JS chunk"]
                ASYNC_FCSS["require.f.miniCss<br/>加载 CSS chunk<br/>(MiniCssExtractPlugin 注入)"]
                ASYNC_FPRE["require.f.prefetch<br/>预取 chunk<br/>(不阻塞, 不 push promise)"]
            end

            ASYNC_FJ_DETAIL["检查 installedChunks 状态<br/>0=已加载 / [r,j,p]=加载中 / undefined=未加载"]
            ASYNC_PROMISE["创建 Promise<br/>installedChunks[id] = [resolve, reject, promise]"]
            ASYNC_LOAD["require.l(url, done)<br/>创建 script 标签插入 DOM<br/>设置 onload/onerror"]
            ASYNC_JSONP["脚本执行<br/>self.webpackChunkstudy.push([chunkIds, modules])<br/>push 已被劫持为 webpackJsonpCallback"]
            ASYNC_CALLBACK["webpackJsonpCallback<br/>1. resolve 对应 promise<br/>2. 合并模块到 modules<br/>3. 执行 runtime<br/>4. 检查 require.O 延迟队列"]
            ASYNC_REQUIRE["Promise.all 完成后<br/>require('./src/test.js')<br/>同步执行模块"]

            ASYNC_O["require.O 延迟执行队列<br/>处理 splitChunks 入口协调<br/>main.js 依赖 vendors.js 的场景"]

            ASYNC_ENTRY --> ASYNC_E --> STRATEGIES
            ASYNC_FJ --> ASYNC_FJ_DETAIL --> ASYNC_PROMISE --> ASYNC_LOAD --> ASYNC_JSONP --> ASYNC_CALLBACK
            ASYNC_CALLBACK --> ASYNC_REQUIRE
            ASYNC_CALLBACK --> ASYNC_O

            ASYNC_FCSS -->|"创建 link rel=stylesheet"| ASYNC_REQUIRE
            ASYNC_FPRE -->|"创建 link rel=prefetch<br/>浏览器空闲时下载"| ASYNC_REQUIRE
        end
    end

    RUNTIME --> CJS_SUB
    RUNTIME --> ESM_SUB
    RUNTIME --> ASYNC_SUB

    %% ====================================================================
    %% B. Tapable 钩子系统
    %% ====================================================================
    subgraph TAPABLE_SUB ["tapable-demo.js  Tapable 钩子系统"]
        direction TB
        HOOK_BASE["Hook 基类<br/>_argNames / _taps[]<br/>tap() / tapAsync() / tapPromise()"]

        subgraph SYNC_HOOKS ["同步 Hook (只能用 tap 注册)"]
            SYNC1["SyncHook<br/>依次执行, 忽略返回值<br/>场景: compiler.hooks.run"]
            SYNC2["SyncBailHook<br/>遇到非 undefined 返回值就中断<br/>场景: compiler.hooks.shouldEmit"]
            SYNC3["SyncWaterfallHook<br/>链式传递返回值<br/>场景: compilation.hooks.assetPath"]
            SYNC4["SyncLoopHook<br/>返回非 undefined 从头重来<br/>直到全部返回 undefined"]
        end

        subgraph ASYNC_HOOKS ["异步 Hook (tap/tapAsync/tapPromise 混用)"]
            AHOOK1["AsyncSeriesHook<br/>异步串行, 等上一个完成<br/>场景: compiler.hooks.emit"]
            AHOOK2["AsyncSeriesBailHook<br/>异步串行 + 熔断"]
            AHOOK3["AsyncParallelHook<br/>异步并行, Promise.all<br/>场景: compiler.hooks.make"]
        end

        MINI_COMPILER["MiniCompiler 演示<br/>用各种 Hook 组合<br/>编排完整编译流程"]

        HOOK_BASE --> SYNC_HOOKS
        HOOK_BASE --> ASYNC_HOOKS
        SYNC_HOOKS --> MINI_COMPILER
        ASYNC_HOOKS --> MINI_COMPILER
    end

    %% ====================================================================
    %% C. Loader 管线
    %% ====================================================================
    subgraph LOADER_SUB ["loader-pipeline-demo.js  Loader 完整生命周期"]
        direction TB
        LR["LoaderRunner 类<br/>管理 Loader 完整执行流程"]

        subgraph PITCH_PHASE ["阶段 1: Pitch (从左到右)"]
            LP1["style-loader.pitch()"]
            LP2["css-loader.pitch()"]
            LP3["sass-loader.pitch()"]
            LP1 -->|"无返回值"| LP2 -->|"无返回值"| LP3
        end

        LREAD["阶段 2: 读取源文件"]
        LP3 -->|"Pitch 全部完成"| LREAD

        subgraph NORMAL_PHASE ["阶段 3: Normal (从右到左)"]
            LN1["sass-loader(source)<br/>SCSS -> CSS"]
            LN2["css-loader(css)<br/>CSS -> JS module"]
            LN3["style-loader(js)<br/>注入 style 标签"]
            LN1 --> LN2 --> LN3
        end

        LREAD --> LN1

        PITCH_BAIL["Pitch 熔断机制<br/>pitch 有返回值则:<br/>1. 跳过后续 pitch<br/>2. 跳过读文件<br/>3. 跳过后续 normal<br/>4. 返回值传给上一个 loader"]

        ASYNC_LOADER["Async Loader<br/>this.async() 返回 callback<br/>异步完成后调用<br/>如 babel-loader"]

        DATA_SHARE["this.data 共享<br/>pitch 阶段存数据<br/>normal 阶段读数据"]

        LR --> PITCH_PHASE
        LP2 -.->|"pitch 返回值"| PITCH_BAIL
        LR --> ASYNC_LOADER
        LR --> DATA_SHARE
    end

    %% ====================================================================
    %% D. Tree Shaking
    %% ====================================================================
    subgraph TREESHAKE_SUB ["tree-shaking-demo.js  Tree Shaking 实现"]
        direction TB
        TS1["步骤 1: collectProvidedExports<br/>遍历 AST 收集 export 声明<br/>math.js -> [add, subtract, multiply, PI]"]
        TS2["步骤 2: collectUsedExports<br/>遍历消费方 AST 收集 import<br/>index.js import {add, subtract}<br/>-> math.js.usedExports: [add, subtract]"]
        TS3["步骤 3: markUnusedExports<br/>对比 provided vs used<br/>multiply, PI -> unused"]
        TS4["步骤 4+5: removeUnusedExports<br/>删除 unused 的 export 声明<br/>添加 /* unused harmony export */ 注释"]
        TS5["ESM -> CJS 转换 (esmToCjs)<br/>import {add} from './math'<br/>-> const {add} = require('./math.js')"]
        TS6["生成 bundle<br/>IIFE + modules + require + 入口调用"]

        TS1 --> TS2 --> TS3 --> TS4 --> TS5 --> TS6

        TS_WHY["为什么 CJS 做不了?<br/>require 返回普通对象<br/>math[dynamicKey]() 无法静态分析<br/>require 可在 if/for 内<br/>module.exports 可运行时修改"]

        TS_SIDE["sideEffects 标记<br/>package.json sideEffects: false<br/>-> 所有导出 unused 的模块跳过<br/>sideEffects: ['*.css']<br/>-> CSS 有副作用不跳过"]
    end

    %% ====================================================================
    %% E. Code Splitting
    %% ====================================================================
    subgraph CODESPLIT_SUB ["code-splitting-demo.js  代码分割编译"]
        direction TB
        CS1["阶段 1: buildDependencyGraph<br/>遍历入口 AST"]
        CS_SYNC["识别 require() -> 同步依赖<br/>归入主 chunk"]
        CS_ASYNC["识别 import() -> 动态依赖<br/>callee.type === 'Import'<br/>创建新的 async chunk"]
        CS_REPLACE["AST 替换<br/>import('./lazy')<br/>-> require.e('chunk-lazy')<br/>.then(require.bind(require, './lazy.js'))"]
        CS2["阶段 2: generateMainChunk<br/>同步模块 + require 运行时<br/>+ JSONP 异步加载运行时<br/>(installedChunks / require.e / require.f.j<br/>/ webpackJsonpCallback)"]
        CS3["阶段 3: generateAsyncChunk<br/>JSONP 格式包裹<br/>self.webpackChunk.push(<br/>[['chunk-lazy'], {modules}])"]
        CS_OUT["产出文件<br/>main.js (入口+同步+运行时)<br/>chunk-lazy-module.js (异步)<br/>chunk-lazy-utils.js (异步)<br/>index.html (测试页)"]

        CS1 --> CS_SYNC
        CS1 --> CS_ASYNC --> CS_REPLACE
        CS_SYNC --> CS2
        CS_REPLACE --> CS2
        CS_ASYNC --> CS3
        CS2 --> CS_OUT
        CS3 --> CS_OUT
    end

    %% ====================================================================
    %% F. Source Map
    %% ====================================================================
    subgraph SOURCEMAP_SUB ["source-map-demo.js  Source Map 原理"]
        direction TB
        SM_VLQ["VLQ Base64 编码<br/>1. 符号移到最低位<br/>2. 每 5 位一组<br/>3. 续延位标记<br/>4. 映射到 Base64 字符"]
        SM_SEG["Segment 编码<br/>[产物列偏移, 源文件偏移,<br/>源行偏移, 源列偏移]<br/>全部用相对值 (VLQ 更短)"]
        SM_BUILD["编译模块<br/>保留源码位置信息"]
        SM_OFFSET["计算 bundle 偏移<br/>每个模块在 bundle 中的起始行号<br/>(运行时前缀占行数 + 模块包裹)"]
        SM_GEN["生成 Source Map v3<br/>version / file / sources<br/>sourcesContent / names / mappings"]
        SM_MAPPINGS["mappings 字段<br/>; 分隔行, , 分隔 segment<br/>每行每个映射段用 VLQ 编码"]
        SM_DEVTOOL["webpack devtool 选项<br/>source-map: 完整独立 .map<br/>cheap-source-map: 只映射到行<br/>eval-source-map: 内嵌 eval, 增量最快<br/>cheap-module-source-map: loader 前源码<br/>hidden-source-map: 有 .map 无注释"]

        SM_VLQ --> SM_SEG --> SM_BUILD --> SM_OFFSET --> SM_GEN --> SM_MAPPINGS
        SM_GEN --> SM_DEVTOOL
    end

    %% ====================================================================
    %% G. 持久化缓存
    %% ====================================================================
    subgraph CACHE_SUB ["persistent-cache-demo.js  持久化缓存"]
        direction TB
        PC1["PersistentCache 类<br/>磁盘 JSON 缓存管理器<br/>get(key, etag) / set / save / clear"]
        PC2["ETag 计算<br/>hash(文件内容 + loader配置 + 依赖关系)<br/>真实 webpack 还包括: webpack版本<br/>Node版本 / buildDependencies"]
        PC3["CachedCompiler<br/>在 buildModule 外包缓存层"]
        PC4["编译流程<br/>读文件 -> 计算 ETag -> 查缓存"]
        PC5_HIT["命中: 跳过编译<br/>直接用缓存结果"]
        PC5_MISS["未命中: 正常编译<br/>AST 解析 + 遍历 + 生成<br/>写入缓存"]
        PC6["缓存失效条件<br/>源文件变化 / loader配置变 / webpack版本升级<br/>buildDependencies变 / 手动删除"]

        PC1 --> PC2 --> PC3 --> PC4
        PC4 -->|HIT| PC5_HIT
        PC4 -->|MISS| PC5_MISS
        PC3 --> PC6
    end

    %% ====================================================================
    %% H. Module Federation
    %% ====================================================================
    subgraph MF_SUB ["module-federation-demo.js  模块联邦"]
        direction TB
        MF_CONCEPT["核心概念<br/>Host=消费方 / Remote=暴露方<br/>Container=运行时入口 / Shared=共享依赖"]
        MF_CONTAINER["Container 类<br/>init(shareScope): 初始化共享作用域<br/>get(moduleName): 获取暴露模块"]
        MF_INIT["init() 流程<br/>1. 接收全局 shareScope<br/>2. 将自身共享依赖注册进去<br/>3. 其他容器可使用"]
        MF_GET["get() 流程<br/>返回 Promise of moduleFactory<br/>factory() 执行后返回 module.exports"]
        MF_SHARED["Shared 版本协商<br/>shareScope 中同一包多版本<br/>选择最高兼容版本<br/>不兼容则各用各的"]
        MF_HOST["HostApp 类<br/>registerRemote(): 注册远程容器<br/>importRemote(): 消费远程模块<br/>getSharedModule(): 获取共享依赖"]
        MF_FLOW["完整流程<br/>1. 加载 remoteEntry.js (script 标签)<br/>2. container.init(shareScope)<br/>3. container.get('./Button')<br/>4. factory() 获取 exports"]

        MF_CONCEPT --> MF_CONTAINER
        MF_CONTAINER --> MF_INIT
        MF_CONTAINER --> MF_GET
        MF_INIT --> MF_SHARED
        MF_CONCEPT --> MF_HOST --> MF_FLOW
    end

    %% ====================================================================
    %% I. mini-webpack 完整打包器
    %% ====================================================================
    subgraph MINIWEBPACK_SUB ["mini-webpack/  完整 Webpack 打包器"]
        direction TB

        MW_ENTRY["debugger.js 入口<br/>const compiler = webpack(config)<br/>compiler.run(callback)"]

        subgraph MW_WEBPACK_FN ["webpack(config) 主函数"]
            MW_W1["new Compiler(config)"]
            MW_W2["遍历 plugins<br/>plugin.apply(compiler)<br/>注入钩子回调"]
            MW_W3["return compiler"]
            MW_W1 --> MW_W2 --> MW_W3
        end

        subgraph MW_COMPILER ["Compiler 类 (单例大管家)"]
            MW_C_HOOKS["hooks 生命周期<br/>run / emit / afterEmit / done<br/>基于 tapable SyncHook"]
            MW_C_RUN["run(callback)<br/>1. hooks.run.call()<br/>2. compile(onCompiled)"]
            MW_C_COMPILE["compile(callback)<br/>new Compilation(options)<br/>compilation.build(callback)"]
            MW_C_EMIT["onCompiled 回调<br/>1. hooks.emit.call(assets)<br/>2. 写文件到磁盘<br/>3. hooks.afterEmit.call()<br/>4. callback(null, stats)<br/>5. fs.watch (watch 模式)<br/>6. hooks.done.call()"]
        end

        subgraph MW_COMPILATION ["Compilation 类 (单次编译)"]
            MW_BUILD["build(callback)"]
            MW_ENTRY_PARSE["统一 entry 格式<br/>字符串 -> {main: './src/index.js'}"]
            MW_BUILD_MOD["buildModule(name, modulePath)"]

            subgraph MW_BUILD_STEPS ["buildModule 8 步"]
                MW_S1["Step1: 循环依赖保护<br/>检查 modules 是否已存在"]
                MW_S2["Step2: 读文件<br/>fs.readFileSync"]
                MW_S3["Step3: 创建 module 对象<br/>立即 push 到 this.modules (先占位)"]
                MW_S4["Step4: 应用 Loader<br/>从右到左 reduceRight<br/>use:[A,B,C] -> C(B(A(source)))"]
                MW_S5["Step5: 解析 AST<br/>@babel/parser"]
                MW_S6["Step6: 遍历 AST<br/>@babel/traverse<br/>找 require() 调用<br/>相对路径 -> 模块 ID"]
                MW_S7["Step7: 生成代码<br/>@babel/generator"]
                MW_S8["Step8: 递归编译<br/>所有依赖模块"]

                MW_S1 --> MW_S2 --> MW_S3 --> MW_S4 --> MW_S5 --> MW_S6 --> MW_S7 --> MW_S8
            end

            MW_CHUNK["组装 chunk<br/>一个入口 -> 一个 chunk<br/>chunk = {name, entryModule, modules}"]
            MW_ASSET["生成 assets<br/>getSource(chunk) -> IIFE bundle<br/>支持 [name] [hash] [contenthash]"]

            MW_BUILD --> MW_ENTRY_PARSE --> MW_BUILD_MOD --> MW_BUILD_STEPS
            MW_BUILD_STEPS --> MW_CHUNK --> MW_ASSET
        end

        subgraph MW_PLUGINS ["内置 Plugin"]
            MW_P1["WebpackRunPlugin<br/>hooks.run -> 打印编译开始"]
            MW_P2["WebpackDonePlugin<br/>hooks.done -> 打印编译完成"]
            MW_P3["ManifestPlugin<br/>hooks.emit -> 生成 manifest.json<br/>往 assets 追加文件"]
        end

        MW_LOADER["内置 Loader<br/>commentLoader<br/>在文件末尾追加注释"]

        subgraph MW_SRC ["src/ 示例源码"]
            MW_SRC_IDX["index.js<br/>require('./message')<br/>import('./lazy-module')"]
            MW_SRC_MSG["message.js<br/>require('./greeting')"]
            MW_SRC_GRT["greeting.js<br/>module.exports = fn"]
            MW_SRC_MATH["math.js (ESM)<br/>export add/subtract/multiply/PI"]
            MW_SRC_LAZY["lazy-module.js<br/>动态 import 目标"]

            MW_SRC_IDX --> MW_SRC_MSG --> MW_SRC_GRT
            MW_SRC_IDX -.-> MW_SRC_LAZY
        end

        subgraph MW_CONFIG ["webpack.config.js"]
            MW_CFG["entry: './src/index.js'<br/>output: {path: dist, filename: '[name].js'}<br/>plugins: [RunPlugin, DonePlugin, ManifestPlugin]<br/>module.rules: [{test:/\.js$/, use:[commentLoader]}]<br/>resolve: {extensions: ['.js','.json']}"]
        end

        MW_ENTRY --> MW_WEBPACK_FN
        MW_WEBPACK_FN --> MW_COMPILER
        MW_C_RUN --> MW_C_COMPILE --> MW_COMPILATION
        MW_C_COMPILE --> MW_C_EMIT
    end

    %% ====================================================================
    %% J. mini-devserver HMR 热更新
    %% ====================================================================
    subgraph MINIDEV_SUB ["mini-devserver/  HMR 热更新完整实现"]
        direction TB

        subgraph DEV_COMPILE ["Part 2: 编译器"]
            DEV_FULL["fullBuild()<br/>首次全量编译<br/>统一 entry -> buildModule -> generateBundle"]
            DEV_BM["buildModule(name, path)<br/>与 mini-webpack 一致的 8 步<br/>+ HMR 特有: 处理 module.hot.accept() 路径改写"]
            DEV_INCR["incrementalBuild(changedFilePath)<br/>增量编译: 只重编变更模块<br/>1. delete modules[id]<br/>2. buildModule 重新编译<br/>3. 生成新 hash<br/>4. generateHotUpdate"]
        end

        subgraph DEV_BUNDLE ["Part 3: Bundle 生成 (含 HMR 运行时)"]
            DEV_GEN["generateBundle()<br/>modules + cache + require<br/>+ HMR 状态 + module.hot API<br/>+ webpackHotUpdate<br/>+ WebSocket 客户端"]
            DEV_HOT_API["module.hot.accept(dep, callback)<br/>注册热替换回调<br/>存入 hotAcceptCallbacks"]
            DEV_HOT_UPDATE["webpackHotUpdate(chunkId, updatedModules)<br/>1. 替换 modules 中的模块代码<br/>2. 删除 cache (清缓存)<br/>3. 执行 accept 回调<br/>4. 无回调则 location.reload()"]
            DEV_WS_CLIENT["WebSocket 客户端<br/>维护 lastHash / currentHash<br/>收到 hash + ok 消息<br/>触发 hotCheck()"]
            DEV_HOTCHECK["hotCheck(hash)<br/>1. fetch /{hash}.hot-update.json<br/>   获取变更 chunk 列表<br/>2. 创建 script 标签加载<br/>   /{chunk}.{hash}.hot-update.js<br/>   执行 webpackHotUpdate"]
        end

        subgraph DEV_SERVER ["Part 4+5: HTTP + WebSocket 服务器"]
            DEV_HTTP["HTTP 服务器 :8080<br/>GET / -> index.html (磁盘)<br/>GET /bundle.js -> 内存<br/>GET /*.hot-update.json -> 内存<br/>GET /*.hot-update.js -> 内存"]
            DEV_WS["WebSocket 服务器<br/>新连接发送当前 hash + ok<br/>broadcast() 广播消息"]
        end

        subgraph DEV_WATCH ["Part 6: 文件监听"]
            DEV_FS["fs.watch(src/, recursive)<br/>200ms 防抖"]
            DEV_FLOW["文件变化流程<br/>1. incrementalBuild(changedFile)<br/>2. generateHotUpdate(oldHash, moduleId)<br/>3. generateBundle() 更新完整 bundle<br/>4. broadcast({type:'hash', hash:newHash})<br/>5. broadcast({type:'ok'})"]
        end

        DEV_HOT_FILES["热更新文件<br/>/{oldHash}.hot-update.json<br/> -> {c: {main: true}}<br/>/main.{oldHash}.hot-update.js<br/> -> self.webpackHotUpdate('main', {modules})"]

        subgraph DEV_SRC ["src/ 示例源码"]
            DEV_IDX["index.js<br/>require name/age -> render()<br/>module.hot.accept('./name', render)<br/>module.hot.accept('./age', render)"]
            DEV_NAME["name.js<br/>module.exports = '不要秃头啊'"]
            DEV_AGE["age.js<br/>module.exports = '99'"]
        end

        DEV_HTML["index.html<br/>input 输入框验证状态不丢失<br/>script src=/bundle.js"]

        DEV_FULL --> DEV_BM
        DEV_BM --> DEV_GEN
        DEV_GEN --> DEV_HOT_API
        DEV_GEN --> DEV_HOT_UPDATE
        DEV_GEN --> DEV_WS_CLIENT --> DEV_HOTCHECK
        DEV_FS --> DEV_FLOW --> DEV_INCR
        DEV_INCR --> DEV_HOT_FILES
        DEV_HOT_FILES --> DEV_HOTCHECK
    end

    %% ====================================================================
    %% 文件间关联关系 (虚线)
    %% ====================================================================
    CJS_SUB -.->|"CJS 运行时基础"| MW_ASSET
    ESM_SUB -.->|"ESM live binding"| TREESHAKE_SUB
    ASYNC_SUB -.->|"运行时对应编译时"| CODESPLIT_SUB
    ASYNC_SUB -.->|"JSONP 机制复用"| MF_SUB
    TAPABLE_SUB -.->|"Hook 系统驱动"| MW_COMPILER
    LOADER_SUB -.->|"Loader 执行细节"| MW_S4
    CODESPLIT_SUB -.->|"chunk 拆分 -> remote exposes"| MF_SUB
    TREESHAKE_SUB -.->|"ESM 静态分析"| MW_S6
    SOURCEMAP_SUB -.->|"位置追踪"| MW_S7
    CACHE_SUB -.->|"缓存层包裹"| MW_BUILD_MOD

    %% ====================================================================
    %% HMR 完整数据流 (粗线)
    %% ====================================================================
    DEV_NAME ==>|"修改文件保存"| DEV_FS
    DEV_FS ==>|"检测到变化"| DEV_INCR
    DEV_INCR ==>|"生成热更新文件"| DEV_HOT_FILES
    DEV_WS ==>|"推送 hash + ok"| DEV_WS_CLIENT
    DEV_WS_CLIENT ==>|"fetch json + load js"| DEV_HOT_UPDATE
    DEV_HOT_UPDATE ==>|"执行 accept 回调"| DEV_IDX

    %% ====================================================================
    %% 样式
    %% ====================================================================
    classDef mainNode fill:#4a90d9,stroke:#2c5aa0,color:#fff,stroke-width:2px
    classDef subTitle fill:#f5a623,stroke:#d48806,color:#fff,stroke-width:2px
    classDef codeNode fill:#e8f4fd,stroke:#4a90d9,color:#333
    classDef greenNode fill:#d4edda,stroke:#28a745,color:#333
    classDef warnNode fill:#fff3cd,stroke:#ffc107,color:#333
    classDef pinkNode fill:#f8d7da,stroke:#dc3545,color:#333

    class ROOT mainNode
    class RUNTIME,TAPABLE,LOADER,TREESHAKE,CODESPLIT,SOURCEMAP,CACHE,MF,MINIWEBPACK,MINIDEV subTitle
    class CJS1,CJS3,ESM1,ESM3,ASYNC_E,ASYNC_CALLBACK,HOOK_BASE,LR,TS1,TS2,TS3,CS1,SM_VLQ,PC1,PC3,MF_CONTAINER,MF_HOST codeNode
    class CJS5,PC5_HIT,ASYNC_REQUIRE greenNode
    class PITCH_BAIL,TS_WHY,TS_SIDE,PC6 warnNode
    class DEV_HOT_UPDATE,DEV_HOTCHECK,DEV_HOT_FILES pinkNode
```
