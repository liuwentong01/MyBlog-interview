/**
 * webpack.js —— 手写 Webpack 核心实现
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  整体运行流程                                                             │
 * │                                                                         │
 * │  webpack(config)                                                        │
 * │    │                                                                    │
 * │    ├─ new Compiler(config)                                              │
 * │    ├─ plugin.apply(compiler)  × N   ← 挂载所有插件                       │
 * │    └─ return compiler                                                   │
 * │                                                                         │
 * │  compiler.run(callback)                                                 │
 * │    │                                                                    │
 * │    ├─ hooks.run.call()              ← 触发"编译开始"钩子                  │
 * │    ├─ compiler.compile()                                                │
 * │    │    └─ new Compilation(config)                                      │
 * │    │         └─ compilation.build()                                     │
 * │    │              ├─ 遍历 entry → buildModule(入口文件)                   │
 * │    │              │    ├─ 读文件内容（fs.readFileSync）                    │
 * │    │              │    ├─ 应用 Loader（从右到左链式调用）                   │
 * │    │              │    ├─ 解析 AST（@babel/parser）                       │
 * │    │              │    ├─ 遍历 AST 找出所有 require() 调用                 │
 * │    │              │    │    ├─ 将相对路径改写为模块 ID                      │
 * │    │              │    │    └─ 收集依赖到 module.dependencies             │
 * │    │              │    ├─ 重新生成代码（@babel/generator）                  │
 * │    │              │    └─ 递归处理所有依赖模块                              │
 * │    │              ├─ 组装 chunk（一个入口 → 一个 chunk）                    │
 * │    │              └─ 生成 assets（chunk → 可运行的 bundle 字符串）          │
 * │    │                                                                    │
 * │    ├─ hooks.emit.call(assets)       ← 触发"写文件前"钩子，插件可修改产出    │
 * │    ├─ 写文件到磁盘                                                        │
 * │    ├─ hooks.afterEmit.call(assets)  ← 触发"写文件后"钩子                  │
 * │    ├─ callback(null, stats)                                              │
 * │    ├─ fs.watch(所有涉及文件)         ← watch 模式：文件变化则重新编译        │
 * │    └─ hooks.done.call()             ← 触发"编译完成"钩子                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 实现的核心能力：
 *   1. webpack()       主函数：读取配置 → 挂载 Plugin → 返回 Compiler
 *   2. Compiler        大管家：生命周期钩子管理 / 驱动编译 / 写出文件 / watch 模式
 *   3. Compilation     编译器：针对一次编译的完整处理流程
 *   4. Plugin 系统     基于 tapable SyncHook，通过 apply(compiler) 注入钩子
 *   5. Loader 系统     根据 module.rules 匹配文件，从右到左链式转换源代码
 *   6. Watch 模式      监听所有涉及文件，变化时自动重新编译
 *   7. emit 钩子       写文件前的钩子，Plugin 可在此追加/修改产出文件（如 HTML）
 *   8. [hash] 支持     output.filename 支持 [name].[hash].js
 *   9. 循环依赖保护     编译时提前占位，防止 A→B→A 导致的无限递归
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // 用于生成文件内容哈希

const parser = require('@babel/parser');        // JS → AST
const traverse = require('@babel/traverse').default; // 遍历/修改 AST
const generator = require('@babel/generator').default; // AST → JS 代码
const types = require('@babel/types');           // 创建 AST 节点（如字符串字面量）
const { SyncHook } = require('tapable');         // 同步钩子，实现生命周期事件

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 将路径中的 \ 替换为 /（兼容 Windows 系统）
 * 在 Windows 上 path.join 会生成 src\index.js，需统一为 src/index.js
 */
function toUnixPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

/**
 * 模块 ID 的基准目录 = 执行命令时所在的目录（项目根目录）
 *
 * 为什么用 process.cwd() 而不是 __dirname？
 *   __dirname 是 webpack.js 文件所在目录，固定不变。
 *   process.cwd() 是用户执行 node 命令时所在的目录，才是项目根目录。
 *   模块 ID 需要相对于项目根目录，所以用 process.cwd()。
 *
 * 例：在 /project 目录下执行 node debugger.js
 *   baseDir = '/project'
 *   模块 /project/src/index.js 的 ID = './src/index.js'
 */
const baseDir = toUnixPath(process.cwd());

/**
 * 自动补全文件扩展名
 *
 * 用户写 require('./foo') 时，webpack 会依次尝试：
 *   ./foo   → 不存在
 *   ./foo.js → 存在 → 返回 ./foo.js
 *
 * @param {string}   modulePath  不含扩展名的路径
 * @param {string[]} extensions  候选扩展名列表，如 ['.js', '.json']
 * @returns {string}             找到的完整路径
 * @throws  {Error}              所有扩展名都尝试失败时抛出
 */
function tryExtensions(modulePath, extensions) {
  // 如果路径本身就能找到文件（已带扩展名），直接返回
  if (fs.existsSync(modulePath)) {
    return modulePath;
  }
  for (const ext of extensions) {
    const filePath = modulePath + ext;
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  throw new Error(`无法找到模块: ${modulePath}，已尝试扩展名: ${extensions.join(', ')}`);
}

/**
 * 根据文件内容生成 8 位 MD5 哈希（用于 [hash] 占位符）
 *
 * 在真实 webpack 中，hash 是根据整个编译过程计算的。
 * 这里简化为对 bundle 内容取 MD5，内容不变则 hash 不变，可用于缓存控制。
 *
 * @param {string} content  文件内容字符串
 * @returns {string}        8 位十六进制哈希，如 'a3f2b1c9'
 */
function createHash(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

/**
 * 根据 chunk 信息，生成最终可在浏览器/Node 中直接运行的 bundle 代码。
 *
 * 生成的 bundle 结构（IIFE 自执行函数）：
 *
 * (() => {
 *   // 1. modules 对象：存放所有模块的代码
 *   //    key = 模块 ID（相对路径）
 *   //    value = 包装该模块代码的函数（参数是 module / exports / require）
 *   var modules = {
 *     "./src/greeting.js": (module, exports, require) => { ... },
 *     "./src/message.js":  (module, exports, require) => { ... },
 *     "./src/index.js":    (module, exports, require) => { ... },
 *   };
 *
 *   // 2. 模块缓存：每个模块只执行一次，结果被缓存（与 Node.js 行为一致）
 *   var cache = {};
 *
 *   // 3. 自定义 require：浏览器不认识原生 require，这里手动实现
 *   function require(moduleId) {
 *     if (cache[moduleId]) return cache[moduleId].exports; // 命中缓存直接返回
 *     var module = (cache[moduleId] = { exports: {} });   // 创建模块对象并立即缓存
 *     modules[moduleId](module, module.exports, require); // 执行模块代码
 *     return module.exports;                              // 返回模块导出值
 *   }
 *
 *   // 4. 从入口模块开始执行（不直接内嵌代码，而是通过 require 调用）
 *   //    这样入口模块能拿到正确的 module / exports 参数
 *   require("./src/index.js");
 * })();
 *
 * 为什么用 require(entryId) 而不是直接内嵌入口代码？
 *   直接内嵌时，外层作用域没有 `module` 变量，如果入口模块有 `module.exports = ...`
 *   就会报 ReferenceError。通过 require(entryId) 调用，可以保证入口模块在正确的
 *   模块上下文中执行。
 *
 * @param {object} chunk  代码块对象 { name, entryModule, modules }
 * @returns {string}      可直接运行的 JS 字符串
 */
function getSource(chunk) {
  return `
/* ===== mini-webpack bundle: ${chunk.name} ===== */
(() => {

  /* ---------- 模块注册表 ----------
   * 每个模块被包裹在一个函数中，参数 module/exports/require 由运行时注入。
   * 模块 ID 是相对于项目根目录的路径，与 Node.js 的模块解析规则一致。
   */
  var modules = {
    ${chunk.modules
      .map(
        (mod) => `
    /* 模块: ${mod.id} */
    "${mod.id}": (module, exports, require) => {
${mod._source}
    }`
      )
      .join(',')}
  };

  /* ---------- 模块缓存 ----------
   * 用于保证每个模块只被执行一次（幂等性）。
   * 同时也是解决循环依赖的关键：A 执行中就将 A 放入缓存，
   * 当 B 又 require(A) 时，直接拿到 A 当前的（未完成的）exports，不会死循环。
   */
  var cache = {};

  /* ---------- 自定义 require ----------
   * 浏览器没有内置 require，这里手动实现 CommonJS 的模块加载机制。
   * @param {string} moduleId  模块 ID（形如 './src/message.js'）
   * @returns {any}            该模块的 exports 对象
   */
  function require(moduleId) {
    // 命中缓存：模块已经执行过，直接返回缓存的 exports（不重复执行）
    var cachedModule = cache[moduleId];
    if (cachedModule !== undefined) {
      return cachedModule.exports;
    }

    // 创建模块对象，并立即放入缓存（先占位，解决循环依赖问题）
    var module = (cache[moduleId] = { exports: {} });

    // 取出模块函数并执行，传入 module / module.exports / require
    modules[moduleId](module, module.exports, require);

    // 返回模块的导出值
    return module.exports;
  }

  /* ---------- 启动：从入口模块开始执行 ----------
   * 通过 require(entryId) 调用而非直接内嵌代码，
   * 保证入口模块也能拿到正确的 module / exports 上下文。
   */
  require("${chunk.entryModule.id}");

})();
`;
}

// ─── Compilation：专门负责"一次"编译过程 ─────────────────────────────────────
//
// 为什么要单独抽出 Compilation？
//   Compiler 是单例，整个生命周期只有一个。
//   但每次编译（包括 watch 模式下的重新编译）都需要全新的状态（modules、chunks 等）。
//   把编译状态放在 Compilation 里，每次重新编译就 new 一个新的 Compilation，互不干扰。

class Compilation {
  constructor(webpackOptions) {
    this.options = webpackOptions;

    // 本次编译产出的所有模块（每个 require() 到的文件都对应一个模块）
    this.modules = [];

    // 本次编译产出的所有代码块（chunk）
    // 一般一个入口文件对应一个 chunk，chunk 里包含该入口及其所有依赖模块
    this.chunks = [];

    // 最终产出的资源文件：{ 'main.js': '...bundle内容...' }
    // Compiler 会把这个对象里的内容逐一写入磁盘
    this.assets = {};

    // 本次打包涉及到的所有源文件路径（watch 模式用：监听这些文件，变化时重新编译）
    this.fileDependencies = [];
  }

  /**
   * 编译单个模块（核心方法，会递归处理所有依赖）
   *
   * 执行步骤：
   *   1. 如果模块已存在（循环依赖保护），直接返回
   *   2. 读取文件内容
   *   3. 创建模块对象并【立即】放入 this.modules（防止后续递归重复处理）
   *   4. 应用匹配的 Loader（从右到左链式调用）
   *   5. 用 @babel/parser 将代码解析成 AST
   *   6. 遍历 AST，找出所有 require() 调用，将相对路径改写为模块 ID
   *   7. 用 @babel/generator 将修改后的 AST 重新生成代码字符串
   *   8. 递归编译所有依赖模块
   *
   * @param {string} name        所属 chunk 的名称（如 'main'）
   * @param {string} modulePath  模块的绝对路径
   * @returns {object}           模块对象 { id, names, dependencies, _source }
   */
  buildModule(name, modulePath) {
    // ── Step 1：循环依赖保护 ──────────────────────────────────────────────────
    //
    // 场景：模块 A require B，模块 B require A（循环依赖）
    //
    // 如果不加保护，递归顺序是：
    //   buildModule(A) → 发现依赖 B → buildModule(B) → 发现依赖 A
    //   → buildModule(A) → ... → 无限递归 → 栈溢出！
    //
    // 解决方案：在处理依赖之前，先把当前模块放入 this.modules（"先占位"）。
    //   下次递归再遇到同一个模块时，在这里发现它已存在，直接返回，不再递归。
    //
    // 这与 bundle 运行时的缓存策略完全对应：
    //   编译时：this.modules 先占位 → 不重复编译
    //   运行时：cache     先占位 → 不重复执行，且能返回部分导出值

    const moduleId = './' + path.posix.relative(baseDir, modulePath);

    const existModule = this.modules.find((m) => m.id === moduleId);
    if (existModule) {
      // 模块已经在编译（或已编译完成），只需追加所属 chunk 名称
      if (!existModule.names.includes(name)) {
        existModule.names.push(name);
      }
      return existModule;
    }

    // ── Step 2：读取模块源代码 ────────────────────────────────────────────────
    let sourceCode = fs.readFileSync(modulePath, 'utf8');

    // ── Step 3：创建模块对象，立即放入 this.modules（先占位！）────────────────
    //
    // 必须在调用 loader 和递归之前就 push，
    // 这样任何深层的递归遇到同一模块时都能在 Step 1 中命中并提前返回。
    const module = {
      id: moduleId,      // 模块唯一标识符（相对根目录的路径），如 './src/message.js'
      names: [name],     // 该模块所属的 chunk 名称列表（多入口时同一模块可属于多个 chunk）
      dependencies: [],  // 该模块依赖的子模块列表 [{ depModuleId, depModulePath }, ...]
      _source: '',       // 经过 Loader 处理 + AST 改写后的最终代码字符串
    };
    this.modules.push(module); // ← 关键：先占位，再处理

    // ── Step 4：应用 Loader（从右到左）────────────────────────────────────────
    //
    // Loader 的本质：一个函数，接收源代码字符串，返回转换后的字符串。
    //
    // 为什么从右到左？
    //   这是 webpack 的规定，和函数组合（compose）一致：
    //   use: [A, B, C] 等价于 A(B(C(source)))，即 C 先执行，A 最后执行。
    //
    // 示例：
    //   use: [sassLoader, cssLoader] → 先用 cssLoader 处理，再用 sassLoader 处理

    const { rules = [] } = this.options.module || {};
    const loaders = [];
    rules.forEach((rule) => {
      // test 是正则表达式，如 /\.js$/ /\.css$/，用于匹配文件路径
      if (modulePath.match(rule.test)) {
        loaders.push(...rule.use);
      }
    });
    // reduceRight 实现从右到左调用
    sourceCode = loaders.reduceRight((code, loader) => loader(code), sourceCode);

    // ── Step 5 & 6：解析 AST，找出 require() 并改写路径 ─────────────────────
    //
    // 为什么要改写 require() 的路径？
    //
    // 源代码里写的是相对路径：require('./greeting')
    // 但 bundle 里所有模块都在同一个 modules 对象中，用绝对（模块）ID 索引：
    //   modules['./src/greeting.js'] = ...
    //
    // 所以需要把 require('./greeting') 改写为 require('./src/greeting.js')，
    // 才能在运行时用自定义 require 函数正确找到模块。
    //
    // AST（抽象语法树）：把代码解析成树形结构，方便精准修改特定语法节点。
    // 如果用字符串替换，可能会误改注释、字符串等非 require 调用的地方。

    const ast = parser.parse(sourceCode, {
      sourceType: 'module', // 支持 import/export 语法（即使这里处理的是 CJS，也设置为 module 更宽松）
    });
    const extensions = this.options.resolve?.extensions || ['.js'];

    traverse(ast, {
      // CallExpression：所有"函数调用"节点，如 require('xxx')、console.log('xxx')
      CallExpression: (nodePath) => {
        const { node } = nodePath;

        // 过滤：只处理 require('...') 这种直接调用
        // 排除：obj.require('...')、a()、b.c() 等非直接调用形式
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') {
          return;
        }

        // require() 的第一个参数必须是字符串字面量（动态 require 暂不支持）
        const depModuleName = node.arguments[0]?.value;
        if (typeof depModuleName !== 'string') return;

        // 拼出依赖模块的绝对路径（基于当前模块所在目录）
        const dirname = path.posix.dirname(modulePath);
        let depModulePath = path.posix.join(dirname, depModuleName);

        // 补全扩展名：require('./foo') → /abs/path/to/src/foo.js
        depModulePath = tryExtensions(depModulePath, extensions);

        // 记录到 fileDependencies（watch 模式需要监听这些文件）
        this.fileDependencies.push(depModulePath);

        // 生成依赖模块的 ID（相对于根目录）
        const depModuleId = './' + path.posix.relative(baseDir, depModulePath);

        // 修改 AST 节点：将 require 的参数从相对路径替换为模块 ID
        // 例：require('./greeting') → require('./src/greeting.js')
        // types.stringLiteral() 用于创建一个字符串字面量 AST 节点
        node.arguments = [types.stringLiteral(depModuleId)];

        // 记录到当前模块的依赖列表，后续递归编译用
        module.dependencies.push({ depModuleId, depModulePath });
      },
    });

    // ── Step 7：将修改后的 AST 重新生成为代码字符串 ──────────────────────────
    const { code } = generator(ast);
    module._source = code;

    // ── Step 8：递归编译所有依赖模块 ─────────────────────────────────────────
    //
    // 此时 module 已经在 this.modules 中（Step 3 放入的），
    // 如果依赖链中出现循环依赖，在 Step 1 中会检测到并提前返回，不会无限递归。
    module.dependencies.forEach(({ depModulePath }) => {
      this.buildModule(name, depModulePath);
      // 注意：buildModule 内部已经将子模块 push 进 this.modules，这里不再重复 push
    });

    return module;
  }

  /**
   * 构建流程的入口：
   *   找到所有入口文件 → 逐一编译 → 组装 chunk → 生成 assets
   *
   * @param {Function} callback  完成后的回调函数 (err, stats, fileDependencies)
   */
  build(callback) {
    // ── 统一处理 entry 格式 ───────────────────────────────────────────────────
    //
    // webpack 支持多种 entry 写法：
    //   字符串：entry: './src/index.js'          → 单入口，chunk 名默认为 'main'
    //   对象：  entry: { app: './src/app.js' }   → 可自定义 chunk 名，支持多入口
    //
    // 统一转为对象格式，方便后续统一处理。
    let entry = {};
    if (typeof this.options.entry === 'string') {
      entry.main = this.options.entry;
    } else {
      entry = this.options.entry;
    }

    // ── 遍历每个入口，逐一编译 ───────────────────────────────────────────────
    for (const entryName in entry) {
      // path.posix.join 保证路径分隔符为 /（跨平台兼容）
      const entryFilePath = path.posix.join(baseDir, entry[entryName]);

      // 将入口文件也加入 fileDependencies，watch 时需要监听入口文件的变化
      this.fileDependencies.push(entryFilePath);

      // 从入口文件开始递归编译整个依赖树
      // buildModule 内部会递归处理所有依赖，并将所有模块 push 进 this.modules
      const entryModule = this.buildModule(entryName, entryFilePath);

      // ── 组装 chunk ────────────────────────────────────────────────────────
      //
      // 一个 chunk 代表一个"代码块"，通常一个入口对应一个 chunk。
      // chunk 里包含：
      //   - entryModule：入口模块（bundle 运行时从这里开始执行）
      //   - modules：该 chunk 涉及的所有模块（入口 + 所有直接/间接依赖）
      const chunk = {
        name: entryName,  // chunk 名，对应 output.filename 中的 [name]
        entryModule,      // 入口模块对象（用于 bundle 运行时的启动调用）
        modules: this.modules.filter((m) => m.names.includes(entryName)),
      };
      this.chunks.push(chunk);
    }

    // ── 将每个 chunk 转换为输出文件内容 ─────────────────────────────────────
    //
    // 支持 output.filename 中的占位符：
    //   [name]        → chunk 名称（如 'main'）
    //   [hash]        → 基于 bundle 内容的 8 位哈希（内容不变则哈希不变，适合缓存）
    //   [contenthash] → 同 [hash]（这里简化处理，和 [hash] 相同）
    this.chunks.forEach((chunk) => {
      const source = getSource(chunk);
      const hash = createHash(source);

      const filename = this.options.output.filename
        .replace('[name]', chunk.name)
        .replace('[hash]', hash)
        .replace('[contenthash]', hash);

      this.assets[filename] = source;
    });

    // 编译完成，通过回调将结果交给 Compiler
    callback(
      null,
      { chunks: this.chunks, modules: this.modules, assets: this.assets },
      this.fileDependencies
    );
  }
}

// ─── Compiler：整个打包过程的大管家 ───────────────────────────────────────────
//
// Compiler 是单例：整个打包过程只有一个 Compiler 实例。
// 它负责：
//   1. 挂载 Plugin（将 Plugin 的逻辑注入到生命周期钩子中）
//   2. 驱动编译（调用 Compilation 完成实际的编译工作）
//   3. 写出文件（将编译产物写入磁盘）
//   4. 管理生命周期（run → compile → emit → afterEmit → done）
//   5. watch 模式（监听文件变化，自动重新编译）

class Compiler {
  constructor(webpackOptions) {
    this.options = webpackOptions;

    // ── 生命周期钩子（基于 tapable）──────────────────────────────────────────
    //
    // tapable 是 webpack 的核心依赖，提供了一套发布-订阅机制。
    // Plugin 通过 compiler.hooks.xxx.tap('插件名', callback) 注册监听。
    // webpack 在合适的时机通过 hooks.xxx.call() 触发所有监听。
    //
    // SyncHook：同步钩子，按注册顺序依次同步执行。
    //   构造函数参数是该钩子 call() 时传入的参数名列表（用于文档目的）。
    this.hooks = {
      // 编译刚开始时触发（在 compile() 之前）
      run: new SyncHook(),

      // 写文件之前触发，传入 assets 对象
      // Plugin 可以在这里：
      //   - 修改已有的产出文件内容
      //   - 追加新的产出文件（如 HtmlWebpackPlugin 在这里生成 index.html）
      emit: new SyncHook(['assets']),

      // 写文件之后触发，传入 assets 对象
      // 常用于：清理临时文件、发送通知等
      afterEmit: new SyncHook(['assets']),

      // 整个编译流程完成后触发（write + watch 设置之后）
      done: new SyncHook(),
    };
  }

  /**
   * 创建一个新的 Compilation 并执行编译。
   *
   * 每次编译（包括 watch 触发的重新编译）都会创建全新的 Compilation 实例，
   * 保证每次编译的状态（modules/chunks/assets）完全独立，互不干扰。
   *
   * @param {Function} callback  编译完成后的回调
   */
  compile(callback) {
    // 每次都 new 一个全新的 Compilation（清空上次编译状态）
    const compilation = new Compilation(this.options);
    compilation.build(callback);
  }

  /**
   * 启动整个编译流程（对外暴露的入口方法）
   *
   * @param {Function} callback  全部完成后的回调 (err, stats)
   */
  run(callback) {
    // ── 触发 run 钩子 ────────────────────────────────────────────────────────
    // 通知"编译已开始"，Plugin 可以在这里做准备工作（如打印日志、清空输出目录等）
    this.hooks.run.call();

    /**
     * 编译完成后的处理函数：
     *   1. 触发 emit 钩子（Plugin 可修改产出内容）
     *   2. 将产出文件写入磁盘
     *   3. 触发 afterEmit 钩子
     *   4. 执行用户回调
     *   5. 设置 watch 监听
     *   6. 触发 done 钩子
     */
    const onCompiled = (err, stats, fileDependencies) => {
      if (err) {
        callback(err);
        return;
      }

      // ── 触发 emit 钩子 ──────────────────────────────────────────────────────
      // 传入 stats.assets 对象的引用，Plugin 可以直接修改它（添加/删除/修改文件）
      // 因为是引用传递，Plugin 对 assets 的修改会直接反映到后续的文件写出步骤
      this.hooks.emit.call(stats.assets);

      // ── 将产出文件写入磁盘 ──────────────────────────────────────────────────
      const outputPath = this.options.output.path;

      // 如果输出目录不存在，递归创建（如 dist/nested/）
      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      // 遍历 assets 对象，逐一写入（包括 Plugin 在 emit 钩子里追加的文件）
      for (const filename in stats.assets) {
        const filePath = path.join(outputPath, filename);
        fs.writeFileSync(filePath, stats.assets[filename], 'utf8');
        console.log(`  📦 已写出: ${filePath}`);
      }

      // ── 触发 afterEmit 钩子 ─────────────────────────────────────────────────
      this.hooks.afterEmit.call(stats.assets);

      // 执行用户在 compiler.run(callback) 里传入的回调
      // stats.toJson() 参考真实 webpack 的 API 设计
      callback(null, { toJson: () => stats });

      // ── Watch 模式 ──────────────────────────────────────────────────────────
      //
      // 去重后监听所有涉及文件（入口文件 + 所有依赖文件）。
      // 去重原因：同一个文件可能被多个模块 require，fileDependencies 里会重复出现，
      // 不去重会给同一文件绑定多个 fs.watch 监听，既浪费资源又可能重复触发编译。
      const uniqueDeps = [...new Set(fileDependencies)];
      uniqueDeps.forEach((dep) => {
        // 文件发生任何变化（内容修改、权限变更等）时重新执行 compile
        fs.watch(dep, () => this.compile(onCompiled));
      });

      // ── 触发 done 钩子 ──────────────────────────────────────────────────────
      // 通知"本次编译已全部完成"（包括写文件 + watch 设置）
      this.hooks.done.call();
    };

    // 启动编译
    this.compile(onCompiled);
  }
}

// ─── webpack 主函数 ────────────────────────────────────────────────────────────

/**
 * webpack 的本质：一个接收配置对象、返回 Compiler 实例的函数。
 *
 * 使用方式（与真实 webpack 完全一致）：
 *   const compiler = webpack(config);
 *   compiler.run((err, stats) => { ... });
 *
 * @param {object} webpackOptions  webpack.config.js 导出的配置对象
 * @returns {Compiler}             Compiler 实例
 */
function webpack(webpackOptions) {
  // 1. 用配置初始化 Compiler
  const compiler = new Compiler(webpackOptions);

  // 2. 挂载所有 Plugin
  //
  // Plugin 的规范：必须是一个带有 apply(compiler) 方法的类或对象。
  // apply 方法接收 compiler 实例，然后向它的某个（或多个）钩子注册回调。
  //
  // 例：
  //   class MyPlugin {
  //     apply(compiler) {
  //       compiler.hooks.emit.tap('MyPlugin', (assets) => { ... });
  //     }
  //   }
  const { plugins = [] } = webpackOptions;
  for (const plugin of plugins) {
    plugin.apply(compiler);
  }

  return compiler;
}

// ─── 内置 Plugin 示例（供 webpack.config.js 直接使用）────────────────────────

/**
 * WebpackRunPlugin：在编译开始时打印提示信息
 *
 * 使用了 run 钩子（SyncHook，无参数）。
 */
class WebpackRunPlugin {
  apply(compiler) {
    // tap(pluginName, callback)：注册一个同步监听
    compiler.hooks.run.tap('WebpackRunPlugin', () => {
      console.log('\n🚀 [WebpackRunPlugin] 开始编译...');
    });
  }
}

/**
 * WebpackDonePlugin：在编译完成时打印提示信息
 *
 * 使用了 done 钩子（SyncHook，无参数）。
 */
class WebpackDonePlugin {
  apply(compiler) {
    compiler.hooks.done.tap('WebpackDonePlugin', () => {
      console.log('🎉 [WebpackDonePlugin] 编译完成！\n');
    });
  }
}

/**
 * ManifestPlugin：在 emit 钩子中自动生成 manifest.json
 *
 * manifest.json 记录所有产出文件的信息（文件名、大小等），
 * 常用于服务端注入 script 标签或做缓存策略。
 *
 * 这个插件演示了 emit 钩子的核心用法：
 *   - 接收 assets 对象（引用传递）
 *   - 读取已有产出文件的信息
 *   - 往 assets 里追加新文件（manifest.json）
 *   - Compiler 会将所有 assets（含追加的）一并写入磁盘
 */
class ManifestPlugin {
  apply(compiler) {
    // 注册 emit 钩子（参数名 'assets' 与 SyncHook(['assets']) 对应）
    compiler.hooks.emit.tap('ManifestPlugin', (assets) => {
      // 遍历所有产出文件，收集文件名和大小信息
      const manifest = {};
      for (const filename in assets) {
        manifest[filename] = {
          size: Buffer.byteLength(assets[filename], 'utf8'), // 文件字节大小
        };
      }

      // 将 manifest.json 加入产出列表，Compiler 会自动写入磁盘
      assets['manifest.json'] = JSON.stringify(manifest, null, 2);
      console.log('  📄 [ManifestPlugin] 已生成 manifest.json');
    });
  }
}

// ─── 内置 Loader 示例（供 webpack.config.js 直接使用）────────────────────────

/**
 * commentLoader：在每个 JS 文件末尾追加注释
 *
 * Loader 的规范：
 *   - 是一个普通函数
 *   - 接收源代码字符串（source）作为参数
 *   - 返回转换后的代码字符串
 *
 * 这个 Loader 演示了最简单的 Loader 结构，实际项目中可以在这里：
 *   - 将 TypeScript/JSX/Vue SFC 转为普通 JS
 *   - 将 SCSS 转为 CSS
 *   - 添加 source map 注释
 *   - 做代码校验（eslint-loader 等）
 */
const commentLoader = (source) => {
  return source + '\n// ✅ [commentLoader] 此文件已被 Loader 处理';
};

// 导出供外部使用
module.exports = {
  webpack,
  // Plugin
  WebpackRunPlugin,
  WebpackDonePlugin,
  ManifestPlugin,
  // Loader
  commentLoader,
};
