# Webpack 面试 Flashcards — 自测卡片

> 使用方法：看问题，心里默答，再翻看答案。每天过一遍，3 天后只看答题困难的卡片。

---

## Card 1: CommonJS vs ESM 的本质区别

**Q: require() 和 import 在值传递上有什么区别？为什么？**

<details>
<summary>答案</summary>

- **CJS: 值拷贝**。`require()` 执行模块代码，把 `module.exports` 的值拷贝给调用方。源模块后续修改不影响已拷贝的值。
- **ESM: 活绑定(live binding)**。`import` 拿到的是 `Object.defineProperty` 定义的 getter，每次访问都读取源模块的最新值。
- **根本原因**: CJS 是运行时加载（动态），ESM 是编译时静态分析 + 运行时 getter。

**追问: 循环依赖时两者表现？**
- CJS: 返回**部分完成**的 exports（已执行到的部分）
- ESM: 因为是 getter，只要源模块最终赋值了就能拿到（但访问时机不对会报 TDZ 错误）

</details>

---

## Card 2: webpack 异步加载 import() 的运行时原理

**Q: `import('./lazy')` 在运行时经历了哪些步骤？**

<details>
<summary>答案</summary>

1. `import()` 编译成 `require.e(chunkId).then(require.bind(null, moduleId))`
2. `require.e` 遍历 `require.f` 上注册的所有加载策略（策略模式）
3. 核心策略 `require.f.j`：检查 `installedChunks[chunkId]` 的状态
   - `0` = 已加载，跳过
   - `undefined` = 未加载，创建 script 标签发起 JSONP 请求
   - `[resolve, reject, promise]` = 加载中，返回已有 promise
4. 远程 chunk 文件执行 `self["webpackChunk"].push([[chunkId], modules])`
5. `webpackJsonpCallback` 被触发：注册模块 + resolve promise
6. `require.O` 检查所有依赖是否就绪，就绪则执行回调

**一句话**: JSONP + Promise + 三状态管理

</details>

---

## Card 3: Tapable Hook 类型

**Q: webpack 的 7 种 Hook 分别是什么？怎么快速记？**

<details>
<summary>答案</summary>

**4 个同步 + 3 个异步:**

| Hook | 核心行为 |
|------|----------|
| SyncHook | 顺序执行，忽略返回值 |
| SyncBailHook | 返回非 undefined 就**熔断**停止 |
| SyncWaterfallHook | 返回值作为下一个的输入（**瀑布流**） |
| SyncLoopHook | 返回非 undefined 就**从头重来** |
| AsyncSeriesHook | 异步串行 |
| AsyncSeriesBailHook | 异步串行 + 熔断 |
| AsyncParallelHook | 异步并行，全部完成才 resolve |

**记忆口诀**: 同步 4 兄弟（普通、熔断、瀑布、循环），异步 3 兄弟（串行、串行熔断、并行）

</details>

---

## Card 4: Loader 执行顺序

**Q: 配置 `use: [A, B, C]`，执行顺序是什么？pitch 阶段是什么？**

<details>
<summary>答案</summary>

**两阶段:**
1. **Pitch 阶段**: A.pitch → B.pitch → C.pitch（左→右）
2. **Normal 阶段**: C(source) → B(result) → A(result)（右→左）

**Pitch 的特殊作用:**
- 如果某个 pitch 函数有返回值，**立刻掉头**，跳过后续所有 loader
- 例：B.pitch 返回了值 → 直接交给 A 的 normal 执行，C 完全跳过
- 这就是 style-loader 的原理：pitch 中返回一段 JS 代码，跳过后续 loader 对 CSS 的处理

**追问: this.async() 是什么？**
- 让 loader 变成异步的。调用后返回 callback，loader 通过 `callback(null, result)` 传递结果
- 用于需要异步操作的场景（如读文件、网络请求）

</details>

---

## Card 5: Tree Shaking 原理

**Q: Tree Shaking 的 5 个步骤是什么？为什么 CJS 不能 tree shake？**

<details>
<summary>答案</summary>

**5 步流程:**
1. **收集导出** (providedExports): ESM 静态分析，列出模块所有 export
2. **收集使用** (usedExports): 分析哪些 import 实际被引用了
3. **标记未使用**: 给未使用的 export 加 `/* unused harmony export */` 注释
4. **不生成代码**: 未使用的 export 不生成导出语句（但函数体还在）
5. **Terser 删除**: 压缩阶段 Terser 发现代码无引用，彻底删除

**为什么 CJS 不行？**
- `require()` 是运行时执行的函数调用，路径可以是变量 (`require(condition ? 'a' : 'b')`)
- 编译时无法静态确定导入/导出了什么
- ESM 的 `import`/`export` 是关键字，必须在顶层，路径必须是字符串字面量 → 编译时可完全分析

**追问: sideEffects 配置的作用？**
- `package.json` 中设置 `"sideEffects": false` 告诉 webpack：这个包的所有模块都没有副作用
- 如果一个模块的导出都没被用到，可以直接跳过整个模块（不只是跳过导出）

</details>

---

## Card 6: Code Splitting

**Q: `import()` 在编译时和运行时分别做了什么？**

<details>
<summary>答案</summary>

**编译时:**
1. AST 中发现 `import('./lazy')` 调用
2. 为 lazy 模块创建新的 async chunk（独立文件）
3. 将 `import()` 替换为 `require.e(chunkId).then(require.bind(null, moduleId))`
4. 生成 chunk 文件，格式为 JSONP: `self["webpackChunk"].push([[id], {modules}])`

**运行时:**
1. `require.e` 创建 script 标签加载 chunk
2. chunk 执行时调用 `webpackJsonpCallback`，注册模块
3. Promise resolve 后，`require` 执行模块拿到 exports

**一句话**: 编译时拆文件 + 改 AST，运行时 JSONP 加载 + Promise 协调

</details>

---

## Card 7: Source Map

**Q: mappings 字段的编码规则是什么？VLQ 是什么？**

<details>
<summary>答案</summary>

**mappings 结构:**
- `;` 分隔 → 产物的每一行
- `,` 分隔 → 同一行内的每个映射点
- 每个映射点 4-5 个字段：产物列偏移、源文件索引偏移、源码行偏移、源码列偏移、(names 索引偏移)

**为什么用偏移量而不是绝对值？**
- 偏移量通常是 0 或个位数，VLQ 编码后只需 1-2 个字符
- 绝对值可能几百几千，编码后很长

**VLQ 编码过程 (以 12 为例):**
1. 符号处理: 正数 → 左移 1 位，最低位设 0 → 24
2. 每 5 位一组 (低位在前)
3. 还有更多位 → 第 6 位(续延位)设 1；最后一组设 0
4. 每组映射到 Base64 字符表

**devtool 选择:**
- 开发: `eval-source-map`（增量快）
- 生产: `hidden-source-map`（上传 Sentry，不暴露给用户）

</details>

---

## Card 8: 持久化缓存

**Q: webpack 5 的 filesystem cache 如何判断缓存是否有效？**

<details>
<summary>答案</summary>

**ETag 机制:**
- ETag = hash(文件内容 + loader 配置 + webpack 版本 + Node 版本 + buildDependencies + resolve 配置)
- 编译时先算 ETag，和磁盘缓存中的 ETag 比对
- 相同 → 跳过编译，直接用缓存结果
- 不同 → 重新编译，更新缓存

**失效场景:**
- 单文件内容变 → 只有该模块失效
- loader 配置变 → 所有模块失效（ETag 都变了）
- webpack 版本升级 → 全部失效
- webpack.config.js 变 (通过 buildDependencies.config) → 全部失效

**效果:** 大项目首次 30-60s → 二次启动 2-3s

</details>

---

## Card 9: Module Federation

**Q: Module Federation 的 Container 协议是什么？共享依赖怎么协商版本？**

<details>
<summary>答案</summary>

**Container 两个核心方法:**
1. `container.init(shareScope)` — 接收全局共享作用域，注册自己的共享依赖
2. `container.get(moduleName)` — 返回 Promise，resolve 后调用 factory() 拿到 exports

**完整流程:**
1. Host 加载 Remote 的 `remoteEntry.js`（script 标签）
2. `container.init(shareScope)` 初始化
3. `container.get('./Button')` 获取模块工厂
4. `factory()` 执行拿到组件

**共享依赖版本协商:**
- 所有容器的共享依赖注册到同一个 `shareScope` 对象
- shareScope 按包名 + 版本号存储
- 兼容的选最高版本（如 React 18.2 和 18.3 → 用 18.3）
- 不兼容的各用各的（如 React 17 和 18）

**vs npm 的优势:** 无需发包、无需重新构建，运行时直接加载最新版

</details>

---

## Card 10: mini-webpack 核心流程

**Q: buildModule 的 8 个步骤是什么？如何解决循环依赖？**

<details>
<summary>答案</summary>

**buildModule 8 步:**
1. **循环依赖检查**: modules 中已有该模块 → 追加 chunk 名，直接返回
2. **读文件**: `fs.readFileSync`
3. **创建 module 对象并立即 push 到 modules**（先占位！）
4. **应用 Loader**: `use: [A,B,C]` → `A(B(C(source)))` (reduceRight)
5. **解析 AST**: `@babel/parser`
6. **遍历 AST**: `@babel/traverse`，改写 require 路径 + 收集依赖
7. **生成代码**: `@babel/generator`
8. **递归编译依赖**: `dependencies.forEach(dep => buildModule(...))`

**循环依赖解决:**
- 关键是第 3 步"先占位再递归"
- A 依赖 B，B 依赖 A → buildModule(A) 时先把 A 放入 modules → 递归到 B → B 发现 A 已存在 → 直接返回
- 运行时同理: require(A) 先创建 cache[A] → 执行中 require(B) → B 中 require(A) → cache 命中返回部分完成的 exports

**Compiler vs Compilation:**
- Compiler: 单例，管理整个生命周期、hooks、watch
- Compilation: 每次编译 new 一个，独立的 modules/chunks/assets

</details>

---

## Card 11: HMR 热模块替换

**Q: 从修改文件到页面更新，经历了哪些步骤？**

<details>
<summary>答案</summary>

**10 步流程（简化为 6 个关键步骤）:**

1. **文件变化 → fs.watch 检测**（200ms 防抖）
2. **增量编译**: 只重新编译变化的模块，生成新 hash
3. **WS 推送**: 服务器发送 `{type:'hash', hash:'h2'}` + `{type:'ok'}`
4. **浏览器请求变更清单**: `GET /h1.hot-update.json` → 拿到变更的 chunk 列表
5. **加载新代码**: `<script src="/main.h1.hot-update.js">` → 执行 `webpackHotUpdate()`
6. **替换模块**: 替换 modules[id] → **delete cache[id]**（关键！） → 执行 accept 回调

**为什么用 script 标签而不是 fetch？**
- 避免 eval()，兼容 CSP
- 天然回调：脚本加载后自动调用 `webpackHotUpdate()`
- 与 code splitting 的 JSONP 机制复用

**关键细节:**
- `delete cache[moduleId]` 是必须的，否则 require 返回旧值
- 没有 `module.hot.accept` 回调 → 无法局部更新 → 整页刷新

</details>

---

## Card 12: Scope Hoisting (作用域提升)

**Q: Scope Hoisting 做了什么？为什么能优化？哪些模块不能合并？**

<details>
<summary>答案</summary>

**做了什么:**
- 把多个 ESM 模块合并到同一个函数作用域
- 去掉每个模块的 `(module, exports, require) => {}` 函数包装
- 去掉 modules 对象、cache 对象、require 运行时

**3 个好处:**
1. **减少体积**: 去掉函数包装 + 运行时代码（示例中减少 53%）
2. **提升性能**: require() 函数调用 → 直接变量引用，V8 可内联
3. **减少内存**: 100 个闭包 → 1 个 IIFE

**核心步骤:**
1. 为每个模块生成唯一前缀（math\_ / utils\_）避免变量名冲突
2. 去掉 export 关键字，变量名加前缀（add → math\_add）
3. 消费方的 import 引用替换为前缀变量名
4. 按拓扑序组装：被依赖的在前，入口在后

**不能合并 (bail out):**
- 非 ESM（CJS/AMD/UMD）— 无法静态分析绑定
- 被多个 chunk 引用 — 合并后不能共享
- 循环依赖 — 变量提升顺序无法保证
- 使用 eval() — 合并后作用域变了

**开启:** `optimization.concatenateModules: true`（生产模式默认开启）

</details>

---

## Card 13: SplitChunksPlugin (分包策略)

**Q: SplitChunksPlugin 解决什么问题？核心配置有哪些？决策流程是什么？**

<details>
<summary>答案</summary>

**解决什么问题:**
- 多入口/多异步 chunk 共享同一个大依赖时，避免重复打包
- pageA 和 pageB 都用 lodash → 提取到 vendors.js → 只下载一次 + 可被浏览器缓存

**核心配置:**
- `chunks: 'all'` — 同步+异步都优化（推荐）
- `minSize: 20000` — 小于 20KB 不提取（避免请求数太多）
- `minChunks: 2` — 至少被 2 个 chunk 引用才提取
- `cacheGroups` — 分组规则，priority 决定优先级
  - vendors: `test: /node_modules/`, 提取第三方依赖
  - common: `minChunks: 2`, 提取公共业务代码

**决策流程（对每个模块）:**
1. 是入口模块？→ 跳过
2. 按 priority 高→低匹配 cacheGroup
3. 检查 test 条件 → 不匹配就下一个 group
4. 检查 minChunks → 引用次数不够就跳过
5. 检查 minSize → 体积太小就跳过
6. 全部通过 → 提取到新 chunk

**与 import() 的关系:**
- `import()` 决定"在哪里拆"（分割点）
- SplitChunks 决定"拆出来的 chunk 怎么优化"（公共提取）

**缓存优势:**
- vendors.js（lodash）→ 长期缓存（很少变）
- common.js（公共代码）→ 中期缓存
- pageA.js（业务代码）→ 短期缓存（体积小）
- 用户二次访问只需下载变化的业务代码

</details>

---

## 快速复习：13 个主题一句话总结

| # | 主题 | 一句话 |
|---|------|--------|
| 1 | CJS/ESM | CJS 拷贝值+缓存，ESM getter 活绑定 |
| 2 | 异步加载 | JSONP + Promise + 三状态(0/[]/undefined) |
| 3 | Tapable | 7 种 Hook = 7 种遍历策略(熔断/瀑布/循环/并行...) |
| 4 | Loader | pitch 左→右, normal 右→左, pitch 返回值就掉头 |
| 5 | Tree Shaking | ESM 静态分析 → 标记 → Terser 删除, CJS 不行因为动态 |
| 6 | Code Splitting | 编译时拆 chunk + 改 AST, 运行时 JSONP 加载 |
| 7 | Source Map | VLQ 编码偏移量, ; 分行 , 分段, 4-5 个字段 |
| 8 | 持久化缓存 | ETag = hash(内容+配置+版本), 命中跳过编译 |
| 9 | Module Federation | init 注册共享, get 获取模块, 运行时跨应用共享 |
| 10 | mini-webpack | 先占位再递归解决循环依赖, buildModule 8 步 |
| 11 | HMR | WS 推 hash → 请求 json+js → 替换模块 → 清缓存 |
| 12 | Scope Hoisting | 多模块合并到同一作用域, 去闭包+去运行时, 只对 ESM |
| 13 | SplitChunks | 自动提取公共依赖, cacheGroups 按优先级匹配, 本质是缓存优化 |

---

## 学习建议

1. **第一天**: 通读所有卡片，标记不熟的
2. **第二天**: 只看不熟的卡片，尝试不看答案口述
3. **第三天起**: 每天花 5 分钟过一遍一句话总结表，遇到想不起来的翻对应卡片
4. **面试前**: 对着一句话总结表，每个主题展开讲 1 分钟，讲不出来的重点复习
