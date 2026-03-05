/**
 * dev-server.js —— 手写 webpack-dev-server 热更新（HMR）完整实现
 *
 * ┌─────────────────────────── 整体架构 ───────────────────────────────┐
 * │                                                                    │
 * │   ┌──────────────┐  fs.watch   ┌────────────────┐                 │
 * │   │  源码文件     │ ─────────→ │  编译器         │                 │
 * │   │  src/*.js     │  文件变化   │  (AST 分析)    │                 │
 * │   └──────────────┘            └───────┬────────┘                 │
 * │                                       │ 编译完成                   │
 * │                                       ↓                           │
 * │                              ┌────────────────┐                   │
 * │                              │  内存文件系统    │                   │
 * │                              │  (memoryFS)     │                   │
 * │                              │  - bundle.js    │                   │
 * │                              │  - hot-update   │                   │
 * │                              └───┬────────┬───┘                   │
 * │                                  │        │                       │
 * │                     ┌────────────┘        └──────────────┐        │
 * │                     ↓                                    ↓        │
 * │         ┌──────────────────┐              ┌─────────────────┐     │
 * │         │  HTTP 服务器      │              │  WebSocket 服务  │     │
 * │         │  localhost:8080   │              │  (双向通信)      │     │
 * │         │  提供文件下载     │              │  推送 hash 通知  │     │
 * │         └────────┬─────────┘              └────────┬────────┘     │
 * │                  │                                 │              │
 * │                  └──────────┬───────────────────────┘              │
 * │                             ↓                                     │
 * │                    ┌─────────────────┐                            │
 * │                    │  浏览器客户端    │                            │
 * │                    │  - WS 客户端    │                            │
 * │                    │  - HMR 运行时   │                            │
 * │                    │  - 自定义require │                            │
 * │                    └─────────────────┘                            │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * 热更新（HMR）流程：
 *
 *   ① 首次编译：编译所有模块 → 生成 hash h1 → bundle 存入内存
 *   ② 浏览器访问 localhost:8080 → HTTP 返回 index.html + bundle.js
 *   ③ bundle.js 中的 WS 客户端连接服务器，收到初始 hash h1
 *   ④ 用户修改 src/name.js → fs.watch 检测到变化
 *   ⑤ 增量编译该模块 → 生成新 hash h2
 *   ⑥ WebSocket 推送 {type:"hash", hash:"h2"} 和 {type:"ok"} 给浏览器
 *   ⑦ 浏览器用 lastHash=h1 请求 GET /h1.hot-update.json → 拿到变更的 chunk 列表
 *   ⑧ 浏览器用 lastHash=h1 加载 <script src="/main.h1.hot-update.js">
 *   ⑨ TODO hot-update.js 调用 webpackHotUpdate() → 替换模块 → 清缓存 → 执行 accept 回调
 *   ⑩ 页面局部更新完成，输入框等状态不丢失
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;
const types = require("@babel/types");
const { WebSocketServer } = require("ws");

// ═══════════════════════════════════════════════════════════════════════════
// Part 1: 工具函数
// ═══════════════════════════════════════════════════════════════════════════

/** 统一路径分隔符为 /（兼容 Windows） */
function toUnixPath(p) {
  return p.replace(/\\/g, "/");
}

/** 生成随机 hash（模拟 webpack 每次编译的唯一标识） */
function createHash() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * 自动补全文件扩展名
 * require('./foo') → 依次尝试 ./foo、./foo.js、./foo.json
 */
function tryExtensions(modulePath, extensions) {
  if (fs.existsSync(modulePath)) return modulePath;
  for (const ext of extensions) {
    const p = modulePath + ext;
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`找不到模块: ${modulePath}（已尝试: ${extensions.join(", ")}）`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2: 简易编译器（复用 mini-webpack 思路，增加 HMR 相关能力）
// ═══════════════════════════════════════════════════════════════════════════

// 读取配置
const config = require("./webpack.config");
const baseDir = toUnixPath(process.cwd());
const extensions = config.resolve?.extensions || [".js"];
const port = config.devServer?.port || 8080;

// 编译状态（相当于简化版的 memfs，所有编译产物都在内存中）
let modules = {}; // 模块表：{ moduleId → { id, names, dependencies, _source, filePath } }
let currentHash = ""; // 当前编译的 hash
const memoryFS = {}; // 内存文件系统：{ url路径 → 文件内容 }

/**
 * 编译单个模块（核心方法，会递归处理所有依赖）
 *
 * 执行步骤（与 webpack.js 的 Compilation.buildModule 对齐）：
 *   1. 如果模块已存在（循环依赖保护），直接返回
 *   2. 读取文件内容
 *   3. 创建模块对象并【立即】放入 modules（防止后续递归重复处理）
 *   4. 应用匹配的 Loader（从右到左链式调用）
 *   5. 用 @babel/parser 将代码解析成 AST
 *   6. 遍历 AST，找出所有 require() 调用，将相对路径改写为模块 ID
 *      （HMR 特有：同时处理 module.hot.accept() 中的路径改写）
 *   7. 用 @babel/generator 将修改后的 AST 重新生成代码字符串
 *   8. 递归编译所有依赖模块
 *
 * @param {string} name        所属 chunk 的名称（如 'main'）
 * @param {string} modulePath  模块的绝对路径
 * @returns {object}           模块对象 { id, names, dependencies, _source, filePath }
 */
function buildModule(name, modulePath) {
  modulePath = toUnixPath(modulePath);

  // ── Step 1：循环依赖保护 ────────────────────────────────────────────────
  // 在处理依赖之前，先检查模块是否已存在于 modules 中。
  // 如果已存在，说明已经在编译（或已编译完成），直接返回，避免无限递归。
  const moduleId = "./" + path.posix.relative(baseDir, modulePath);

  if (modules[moduleId]) {
    if (!modules[moduleId].names.includes(name)) {
      modules[moduleId].names.push(name);
    }
    return modules[moduleId];
  }

  // ── Step 2：读取模块源代码 ──────────────────────────────────────────────
  let sourceCode = fs.readFileSync(modulePath, "utf8");

  // ── Step 3：创建模块对象，立即放入 modules（先占位！）──────────────────
  // 必须在调用 loader 和递归之前就放入，
  // 这样任何深层的递归遇到同一模块时都能在 Step 1 中命中并提前返回。
  const module = {
    id: moduleId,
    names: [name],
    dependencies: [],
    _source: "",
    filePath: modulePath,
  };
  modules[moduleId] = module;

  // ── Step 4：应用 Loader（从右到左）──────────────────────────────────────
  // Loader 的本质：一个函数，接收源代码字符串，返回转换后的字符串。
  // use: [A, B, C] 等价于 A(B(C(source)))，即 C 先执行，A 最后执行。
  const { rules = [] } = config.module || {};
  const loaders = [];
  rules.forEach((rule) => {
    if (modulePath.match(rule.test)) {
      loaders.push(...rule.use);
    }
  });
  sourceCode = loaders.reduceRight((code, loader) => loader(code), sourceCode);

  // ── Step 5 & 6：解析 AST，找出 require() 并改写路径 ───────────────────
  const ast = parser.parse(sourceCode, { sourceType: "module" });
  const dirname = path.posix.dirname(modulePath);

  traverse(ast, {
    CallExpression(nodePath) {
      const { node } = nodePath;

      // ── 处理 require('./xxx') ──────────────────────────────────────
      // 将相对路径改写为模块 ID，如 require('./name') → require('./src/name.js')
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        node.arguments[0]?.type === "StringLiteral"
      ) {
        const depModuleName = node.arguments[0].value;
        let depModulePath = tryExtensions(path.posix.join(dirname, depModuleName), extensions);
        depModulePath = toUnixPath(depModulePath);
        const depModuleId = "./" + path.posix.relative(baseDir, depModulePath);

        node.arguments = [types.stringLiteral(depModuleId)];
        module.dependencies.push({ depModuleId, depModulePath });
      }

      // ── TODO 处理 module.hot.accept('./xxx', callback) ── HMR 特有 ──────
      // 同样需要把相对路径改写为模块 ID，
      // 这样 HMR 运行时才能正确匹配哪个模块发生了变化
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === "accept" &&
        node.callee.object?.type === "MemberExpression" &&
        node.callee.object.property?.name === "hot" &&
        node.callee.object.object?.type === "Identifier" &&
        node.callee.object.object.name === "module" &&
        node.arguments[0]?.type === "StringLiteral"
      ) {
        const depModuleName = node.arguments[0].value;
        let depModulePath = tryExtensions(path.posix.join(dirname, depModuleName), extensions);
        depModulePath = toUnixPath(depModulePath);
        const depModuleId = "./" + path.posix.relative(baseDir, depModulePath);
        node.arguments[0] = types.stringLiteral(depModuleId);
      }
    },
  });

  // ── Step 7：将修改后的 AST 重新生成为代码字符串 ────────────────────────
  const { code } = generator(ast);
  module._source = code;

  // ── Step 8：递归编译所有依赖模块 ───────────────────────────────────────
  // 此时 module 已在 modules 中（Step 3 放入的），
  // 如果依赖链中出现循环依赖，在 Step 1 中会检测到并提前返回，不会无限递归。
  module.dependencies.forEach(({ depModulePath }) => {
    buildModule(name, depModulePath);
  });

  return module;
}

/**
 * 首次全量编译（与 webpack.js 的 Compilation.build 对齐）
 *
 * 1. 统一 entry 格式（字符串 → 对象）
 * 2. 对每个入口调用 buildModule（内部递归编译整个依赖树）
 * 3. 生成 bundle
 */
function fullBuild() {
  modules = {};

  // ── 统一处理 entry 格式 ────────────────────────────────────────────────
  // webpack 支持多种 entry 写法：
  //   字符串：entry: './src/index.js'          → 单入口，chunk 名默认为 'main'
  //   对象：  entry: { app: './src/app.js' }   → 可自定义 chunk 名，支持多入口
  let entry = {};
  if (typeof config.entry === "string") {
    entry.main = config.entry;
  } else {
    entry = config.entry;
  }

  // ── 遍历每个入口，从入口文件开始递归编译整个依赖树 ──────────────────────
  // buildModule 内部会递归处理所有依赖，并将所有模块放入 modules
  for (const entryName in entry) {
    const entryFilePath = toUnixPath(path.resolve(baseDir, entry[entryName]));
    buildModule(entryName, entryFilePath);
  }

  currentHash = createHash();
  generateBundle();
  return currentHash;
}

/**
 * 增量编译（文件变化时调用）
 *
 * 只重新编译变更的模块，不需要全部重来。
 * 这就是 webpack-dev-server 能做到快速热更新的原因。
 *
 * 实现方式：
 *   1. 删除变更模块在 modules 中的记录
 *   2. 调用 buildModule 重新编译（内部会递归处理依赖）
 *      - 已存在的其他模块会被 Step 1 的循环依赖保护跳过（不重复编译）
 *      - 新增的依赖（用户新加了 require）会被正常编译
 *
 * @param {string} changedFilePath  变更文件的绝对路径
 * @returns {{ oldHash, newHash, changedModuleId } | null}
 */
function incrementalBuild(changedFilePath) {
  changedFilePath = toUnixPath(changedFilePath);
  const moduleId = "./" + path.posix.relative(baseDir, changedFilePath);

  // 如果变更的文件不在已知模块列表中，跳过
  if (!modules[moduleId]) return null;

  // 保存旧 hash（客户端要用它来请求热更新文件）
  const oldHash = currentHash;
  const oldNames = modules[moduleId].names;

  // 删除变更的模块，使 buildModule 能重新编译它
  delete modules[moduleId];

  // 重新编译变更的模块（递归处理依赖，已有模块会被循环依赖保护跳过）
  oldNames.forEach((name) => buildModule(name, changedFilePath));

  // 生成新 hash
  currentHash = createHash();

  // 生成热更新文件（json + js）
  generateHotUpdate(oldHash, moduleId);

  // 同时更新完整 bundle（供新连接/刷新使用）
  generateBundle();

  return { oldHash, newHash: currentHash, changedModuleId: moduleId };
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 3: Bundle 生成（含 HMR 运行时 + WebSocket 客户端）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 生成完整的 bundle.js 并存入 memoryFS
 *
 * bundle 结构：
 *   (function() {
 *     var modules = { ... };       // 所有模块代码
 *     var cache = {};              // 模块缓存
 *     function require(id) { }    // 自定义 require（带 module.hot）
 *     // HMR 运行时                // webpackHotUpdate + accept 机制
 *     // WebSocket 客户端          // 与 dev-server 通信，拉取更新
 *     require(entryId);            // 执行入口
 *   })();
 */
function generateBundle() {
  const entryId = "./" + path.posix.relative(baseDir, toUnixPath(path.resolve(baseDir, config.entry)));

  // 将所有模块序列化为 "moduleId": (module, exports, require) => { code } 格式
  // （与 webpack.js 的 getSource 一致，使用箭头函数包裹模块代码）
  const modulesStr = Object.values(modules)
    .map((mod) => `    /* 模块: ${mod.id} */\n    "${mod.id}": (module, exports, require) => {\n${mod._source}\n    }`)
    .join(",\n");

  const bundle = `
/*
 * ═══════════════════════════════════════════════════════════
 * mini-devserver bundle（自动生成，请勿手动修改）
 * hash: ${currentHash}
 * ═══════════════════════════════════════════════════════════
 */
(function() {

  /* ──────────────────── 模块注册表 ──────────────────── */
  /* 每个模块的源代码被包裹在函数中，参数 module/exports/require 由运行时注入 */
  var modules = {
${modulesStr}
  };

  /* ──────────────────── 模块缓存 ──────────────────── */
  /* 保证每个模块只执行一次（缓存 exports），同时用于解决循环依赖 */
  var cache = {};

  TODO 目前没弄明白HMR相关的状态
  /* ──────────────────── HMR 状态 ──────────────────── */
  /*
   * hotAcceptCallbacks 存储所有 module.hot.accept() 注册的回调
   * 结构：{
   *   "./src/name.js": [
   *     { fromModule: "./src/index.js", callback: function() { render() } }
   *   ]
   * }
   * 当 ./src/name.js 模块被热替换时，会执行所有注册在它上面的回调
   */
  var hotAcceptCallbacks = {};

  /* ──────────────────── module.hot API ──────────────────── */
  /*
   * 为每个模块创建 hot 对象，提供 accept 方法
   *
   * 使用方式（在业务代码中）：
   *   if (module.hot) {
   *     module.hot.accept('./name', function() {
   *       // name 模块更新后的处理逻辑
   *     });
   *   }
   */
  function createModuleHot(moduleId) {
    return {
      /**
       * accept(dep, callback)：声明当 dep 模块更新时，执行 callback
       *
       * @param {string}   dep       依赖模块的 ID（已由编译器从相对路径改写为模块 ID）
       * @param {Function} callback  更新后执行的回调
       */
      accept: function(dep, callback) {
        if (!hotAcceptCallbacks[dep]) hotAcceptCallbacks[dep] = [];
        hotAcceptCallbacks[dep].push({
          fromModule: moduleId,
          callback: callback
        });
      }
    };
  }

  /* ──────────────────── 自定义 require ──────────────────── */
  function require(moduleId) {
    /* 命中缓存：模块已经执行过，直接返回缓存的 exports（不重复执行） */
    var cachedModule = cache[moduleId];
    if (cachedModule !== undefined) {
      return cachedModule.exports;
    }

    /* 创建模块对象，附带 hot API，并立即放入缓存（先占位，解决循环依赖问题） */
    var module = (cache[moduleId] = {
      exports: {},
      hot: createModuleHot(moduleId)
    });

    /* 取出模块函数并执行，传入 module / module.exports / require */
    modules[moduleId](module, module.exports, require);

    /* 返回模块的导出值 */
    return module.exports;
  }

  /* ──────────────────── HMR 热替换核心 ──────────────────── */
  /*
   * webpackHotUpdate 被挂载到全局（self/window）
   * 当浏览器加载 hot-update.js 时，该脚本会调用此函数
   *
   * hot-update.js 的内容大致如下：
   *   self.webpackHotUpdate("main", {
   *     "./src/name.js": function(module, exports, require) {
   *       module.exports = "新的值";
   *     }
   *   });
   *
   * 执行流程：
   *   1. 用新的模块函数替换 modules 注册表中的旧函数
   *   2. 删除该模块的缓存（下次 require 时会重新执行新代码）
   *   3. 找到所有通过 module.hot.accept 注册的回调并执行
   *   4. 回调中通常会 re-require 该模块，从而拿到新的导出值
   */
  self.webpackHotUpdate = function(chunkId, updatedModules) {
    for (var moduleId in updatedModules) {
      /* Step 1：替换模块代码 */
      modules[moduleId] = updatedModules[moduleId];

      /* Step 2：清除缓存（关键！不清除的话 require 会返回旧值） */
      delete cache[moduleId];

      /* Step 3：执行 accept 回调 */
      var callbacks = hotAcceptCallbacks[moduleId];
      if (callbacks && callbacks.length > 0) {
        callbacks.forEach(function(item) {
          item.callback();
        });
        console.log('[HMR] ✅ 模块已热替换: ' + moduleId);
      } else {
        /* 没有 accept 回调 → 该模块变化后无法局部更新，需要整页刷新 */
        console.warn('[HMR] ⚠️ 模块 ' + moduleId + ' 没有注册 accept 回调，刷新页面');
        window.location.reload();
        return;
      }
    }
  };

  /* ──────────────────── WebSocket 客户端 ──────────────────── */
  /*
   * 与 dev-server 建立 WebSocket 长连接
   * 服务端在每次编译完成后，会发送两条消息：
   *   1. {type: "hash", hash: "xxx"}  —— 新的编译 hash
   *   2. {type: "ok"}                 —— 编译成功，可以进行热更新
   *
   * 客户端维护两个 hash 变量：
   *   lastHash    —— 上一次的 hash（用来请求热更新文件）
   *   currentHash —— 最新收到的 hash
   *
   * 为什么需要 lastHash？
   *   服务端不知道客户端当前是什么版本（多窗口场景）。
   *   客户端把自己的 lastHash 发给服务端，服务端才能计算出"从哪个版本到哪个版本"的差异。
   *   具体做法：用 lastHash 作为文件名请求 hot-update 文件。
   */
  (function connectWebSocket() {
    var lastHash, currentHash;
    var socket = new WebSocket("ws://localhost:${port}");

    socket.onopen = function() {
      console.log('[HMR] 🔌 WebSocket 已连接到 dev-server');
    };

    socket.onmessage = function(event) {
      var msg = JSON.parse(event.data);

      if (msg.type === 'hash') {
        /*
         * 收到新 hash：
         *   首次连接：lastHash = undefined, currentHash = h1
         *   后续更新：lastHash = h1, currentHash = h2
         */
        lastHash = currentHash;
        currentHash = msg.hash;
        console.log('[HMR] 📨 收到新 hash:', msg.hash);
      }

      if (msg.type === 'ok') {
        /*
         * 收到 ok 信号：检查是否需要热更新
         *   首次连接时 lastHash 为 undefined → 不触发热更新（正确行为）
         *   后续：lastHash !== currentHash → 有更新 → 开始热替换流程
         */
        if (lastHash && lastHash !== currentHash) {
          hotCheck(lastHash);
        }
      }
    };

    socket.onclose = function() {
      console.log('[HMR] ❌ WebSocket 断开，2秒后重连...');
      setTimeout(connectWebSocket, 2000);
    };

    /**
     * 热更新检查（对应文章中的两次 HTTP 请求）
     *
     * Step 1：请求 /{oldHash}.hot-update.json
     *         → 获取哪些 chunk 发生了变化
     *         → 响应示例：{ c: { main: true } }
     *
     * Step 2：对每个变化的 chunk，加载 /{chunkName}.{oldHash}.hot-update.js
     *         → 该 JS 文件会调用 self.webpackHotUpdate()
     *         → 从而触发模块替换和 accept 回调
     *
     * @param {string} hash  上一次的 hash（用于定位热更新文件）
     */

    /** 
     * 为什么用 <script> 加载 hot-update.js 而不是 fetch？
     * 1. 避免 eval()，兼容 CSP（Content Security Policy）
     * 如果用 fetch() 拿回 JS 字符串，就必须用 eval() 或 new Function() 来执行它。
     * 但很多网站的 CSP 策略禁止 unsafe-eval，这会直接导致 HMR 失效。
     * 而 <script> 标签加载的脚本走的是浏览器原生的脚本执行通道，不受 eval 类 CSP 限制。
     * 2. 天然的「回调」机制
     * JSONP 的精髓在于：脚本加载后立即调用一个预先约定好的全局函数（这里是 self.webpackHotUpdate）。
     * 不需要任何额外的协调机制，脚本一执行就自动把新模块注册进去了。这比 fetch + eval 的流程更简洁。
     **/
    function hotCheck(hash) {
      console.log('[HMR] 🔄 开始热替换，请求更新清单...');

      /* Step 1：拉取 hot-update.json（哪些 chunk 变了？）*/
      fetch('/' + hash + '.hot-update.json')
        .then(function(res) {
          if (!res.ok) throw new Error('hot-update.json 请求失败: ' + res.status);
          return res.json();
        })
        .then(function(manifest) {
          console.log('[HMR] 📋 变更的 chunk:', Object.keys(manifest.c));

          /* Step 2：对每个变更 chunk，用 <script> 加载 hot-update.js */
          Object.keys(manifest.c).forEach(function(chunkId) {
            var script = document.createElement('script');
            script.src = '/' + chunkId + '.' + hash + '.hot-update.js';
            script.onerror = function() {
              console.error('[HMR] 加载 hot-update.js 失败');
              window.location.reload();
            };
            document.head.appendChild(script);
          });

          /* 更新 lastHash，为下一次热更新做准备 */
          lastHash = currentHash;
        })
        .catch(function(err) {
          console.warn('[HMR] 热更新失败，将刷新页面:', err.message);
          window.location.reload();
        });
    }
  })();

  /* ──────────────────── 启动入口模块 ──────────────────── */
  require("${entryId}");

})();
`;

  memoryFS["/bundle.js"] = bundle;
}

/**
 * 生成热更新文件（存入 memoryFS，等浏览器请求时返回）
 *
 * 会生成两个文件：
 *   1. /{oldHash}.hot-update.json    —— 变更 chunk 清单
 *   2. /main.{oldHash}.hot-update.js —— 变更模块的新代码
 *
 * 为什么文件名用 oldHash 而不是 newHash？
 *   因为浏览器手上只有 lastHash（= oldHash），用它来构造请求 URL。
 *   服务端根据 oldHash 和当前 hash 的差异，返回中间的变更内容。
 *
 * @param {string} oldHash          上一次编译的 hash
 * @param {string} changedModuleId  变更的模块 ID
 */
function generateHotUpdate(oldHash, changedModuleId) {
  const mod = modules[changedModuleId];

  // ── hot-update.json：告诉浏览器哪些 chunk 需要更新 ──
  // 在我们的简化实现中，所有模块都在 "main" chunk 中
  const manifest = { c: { main: true } };
  memoryFS[`/${oldHash}.hot-update.json`] = JSON.stringify(manifest);

  // ── hot-update.js：包含变更模块的新代码 ──
  // 浏览器通过 <script> 加载后，会调用 self.webpackHotUpdate()
  const updateJS = `
    // hot-update: hash=${oldHash} → 模块 ${changedModuleId} 已更新
    self.webpackHotUpdate("main", {
      "${changedModuleId}": (module, exports, require) => {
    ${mod._source}
      }
    });
  `;
  memoryFS[`/main.${oldHash}.hot-update.js`] = updateJS;
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 4: HTTP 服务器
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP 服务器负责响应浏览器的静态资源请求：
 *
 *   GET /           → 返回 index.html（从磁盘读取）
 *   GET /bundle.js  → 返回编译后的 bundle（从内存读取）
 *   GET /*.hot-update.json → 返回热更新清单（从内存读取）
 *   GET /*.hot-update.js   → 返回热更新模块代码（从内存读取）
 *
 * 为什么用内存而不是写到磁盘？
 *   参考文章提到的 memfs：每次编译的产物保留在内存中，
 *   避免频繁的磁盘 I/O，大幅提升 dev 模式下的编译速度。
 */
const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url;

  // 先从内存文件系统中查找（bundle.js、hot-update 文件）
  if (memoryFS[url]) {
    const contentType = url.endsWith(".json") ? "application/json" : "application/javascript";
    res.writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` });
    res.end(memoryFS[url]);
    return;
  }

  // 不在内存中 → 尝试从磁盘读取（index.html 等静态文件）
  const filePath = path.join(__dirname, url);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const mimeTypes = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": `${mimeTypes[ext] || "text/plain"}; charset=utf-8` });
    res.end(fs.readFileSync(filePath, "utf8"));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 5: WebSocket 服务器
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WebSocket 服务器与 HTTP 服务器共享端口（通过 HTTP Upgrade 协议升级）
 *
 * 它的唯一职责：在编译完成后，向所有连接的浏览器发送两条消息
 *   1. {type: "hash", hash: "xxx"}  → 告知新的编译 hash
 *   2. {type: "ok"}                 → 告知编译成功，浏览器可以开始拉取更新
 */
const wss = new WebSocketServer({ server });

// 记录所有连接的客户端
const wsClients = new Set();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  console.log(`  🔌 新的 WebSocket 连接（当前 ${wsClients.size} 个客户端）`);

  // 新连接时，立即发送当前 hash（初始化客户端状态）
  ws.send(JSON.stringify({ type: "hash", hash: currentHash }));
  ws.send(JSON.stringify({ type: "ok" }));

  ws.on("close", () => {
    wsClients.delete(ws);
    console.log(`  🔌 WebSocket 断开（剩余 ${wsClients.size} 个客户端）`);
  });
});

/**
 * 广播消息给所有连接的客户端
 * @param {object} data  要发送的消息对象
 */
function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 6: 文件监听 + HMR 流程编排
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 监听 src 目录下的文件变化
 *
 * 当文件保存时：
 *   1. 增量编译变更的模块
 *   2. 生成热更新文件（json + js）存入内存
 *   3. 通过 WebSocket 通知所有客户端"有新版本了"
 *   4. 客户端收到通知后，主动拉取热更新文件并应用
 *
 * 使用 debounce 防抖：编辑器保存文件时可能触发多次 change 事件
 */
function startWatching() {
  const srcDir = path.resolve(__dirname, "src");
  let debounceTimer = null;

  fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith(".js")) return;

    // 防抖：200ms 内多次变化只处理最后一次
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const changedFile = path.resolve(srcDir, filename);
      console.log(`\n  --- 📝 文件变化: src/${filename} ---`);

      // ── Step 1：增量编译 ──
      const result = incrementalBuild(changedFile);
      if (!result) {
        console.log("  ⏭️  变更的文件不在模块列表中，跳过");
        return;
      }

      console.log(`  📦 增量编译完成`);
      console.log(`     旧 hash: ${result.oldHash}`);
      console.log(`     新 hash: ${result.newHash}`);
      console.log(`     变更模块: ${result.changedModuleId}`);
      console.log(`  📄 已生成热更新文件:`);
      console.log(`     /${result.oldHash}.hot-update.json`);
      console.log(`     /main.${result.oldHash}.hot-update.js`);

      // ── Step 2：通过 WebSocket 通知所有客户端 ──
      console.log(`  📡 通知 ${wsClients.size} 个客户端:`);
      console.log(`     → {type: "hash", hash: "${result.newHash}"}`);
      console.log(`     → {type: "ok"}`);

      broadcast({ type: "hash", hash: result.newHash });
      broadcast({ type: "ok" });
    }, 200);
  });

  console.log(`  👀 正在监听 src/ 目录的文件变化...\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 7: 启动！
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n  🚀 mini-devserver 启动中...\n");

// Step 1：首次全量编译
const initialHash = fullBuild();
console.log(`  📦 首次编译完成，hash: ${initialHash}`);
console.log(`     模块列表:`);
Object.values(modules).forEach((mod) => {
  console.log(`     - ${mod.id} (${mod.dependencies.length} 个依赖)`);
});

// Step 2：启动 HTTP + WebSocket 服务器
server.listen(port, () => {
  console.log(`\n  🌐 HTTP  服务器: http://localhost:${port}`);
  console.log(`  🔌 WebSocket 服务器: ws://localhost:${port}`);
  console.log(`\n  ✏️  请修改 src/name.js 或 src/age.js 并保存，观察热更新效果`);
});

// Step 3：开始监听文件变化
startWatching();
