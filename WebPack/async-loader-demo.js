/**
 * 本文件模拟了 webpack 5 对 import() 语法编译后生成的运行时代码
 * 结构和命名与真实 webpack 产物保持一致，方便对照学习
 *
 * ═══════════════════════════════════════════════════════
 *  完整调用链路（核心！！！）
 * ═══════════════════════════════════════════════════════
 *
 *  import("./test.js")
 *       ↓  webpack 编译转换
 *  require.e("src_test_js").then(require.bind(require, "./src/test.js"))
 *       ↓  require.e（遍历 require.f 中所有策略，收集 promises）
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  require.f.j        → 创建 <script>，通过 JSONP 加载 JS     │
 *  │  require.f.miniCss  → 创建 <link>，加载 CSS                  │
 *  │  require.f.prefetch → 创建 <link rel="prefetch"> 预取        │
 *  │  （每个策略自行判断该 chunk 是否需要自己处理）                    │
 *  └─────────────────────────────────────────────────────────────┘
 *       ↓  以 require.f.j 为例
 *  检查 installedChunks 状态 → 创建 promise → require.l 加载脚本
 *       ↓  require.l
 *  创建 <script> 标签插入 DOM，设置 onload / onerror 回调
 *       ↓  脚本下载完成并执行
 *  脚本内容调用 self.webpackChunkstudy.push([chunkIds, modules])
 *  而 push 已被劫持为 webpackJsonpCallback
 *       ↓  webpackJsonpCallback
 *  将新模块工厂函数合并到 modules → resolve 对应 promise
 *       ↓  Promise.all 等待所有策略的 promise 完成（JS + CSS ...）
 *  require("./src/test.js") 同步执行模块 → 返回 module.exports
 *
 * ═══════════════════════════════════════════════════════
 *  另一种异步场景：splitChunks 入口协调（require.O）
 * ═══════════════════════════════════════════════════════
 *
 *  HTML: <script src="vendors.js" defer> + <script src="main.js" defer>
 *       ↓  两个脚本并行加载，执行顺序不确定
 *  main.js 先执行完 → 调用 require.O(undefined, ["vendors"], factory)
 *       ↓  注册延迟任务
 *  vendors.js 加载完成 → webpackJsonpCallback 合并模块
 *       ↓  webpackJsonpCallback 末尾调用 require.O()
 *  检查延迟队列 → "vendors" 已就绪 → 执行入口 factory()
 *
 * ═══════════════════════════════════════════════════════
 *  关键数据结构
 * ═══════════════════════════════════════════════════════
 *
 *  modules (即 __webpack_modules__):
 *    存放所有模块的工厂函数（同步模块初始就有，异步模块加载后合并进来）
 *
 *  cache (即 __webpack_module_cache__):
 *    模块执行结果缓存，避免重复执行
 *
 *  installedChunks:
 *    记录每个 chunk 的加载状态
 *      0                         → 已加载完成
 *      [resolve, reject, promise] → 正在加载中
 *      undefined                  → 尚未加载
 */

var modules = {};
var cache = {};

// ================================================================
// require 函数（__webpack_require__）
// ================================================================
/**
 * 同步加载并执行模块，等同于 CommonJS 的 require
 * 功能：从 modules 中取出工厂函数执行，将结果缓存到 cache
 */
function require(moduleId) {
  var cachedModule = cache[moduleId];
  if (cachedModule !== undefined) {
    return cachedModule.exports;
  }

  // 创建模块对象并立即放入缓存（提前缓存可处理循环依赖）
  var module = (cache[moduleId] = {
    exports: {},
  });

  modules[moduleId](module, module.exports, require);

  return module.exports;
}

// ================================================================
// require 辅助方法
// ================================================================

/**
 * require.o — hasOwnProperty 简写（__webpack_require__.o）
 * webpack 内部大量使用，确保只操作对象自身属性
 */
require.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

/**
 * require.defineProperty — 为 exports 定义 getter 属性（__webpack_require__.d）
 * 实现 ES Module 的 live binding（动态绑定）特性
 * 只有 definition 上有而 exports 上没有的属性才会被定义，防止重复定义
 */
require.defineProperty = (exports, definition) => {
  for (var key in definition) {
    if (require.o(definition, key) && !require.o(exports, key)) {
      Object.defineProperty(exports, key, {
        enumerable: true,
        get: definition[key],
      });
    }
  }
};

// ================================================================
// Chunk 加载状态表
// ================================================================
/**
 * installedChunks 记录每个 chunk 的加载状态：
 *   0                          → 已加载完成
 *   [resolve, reject, promise] → 正在加载中
 *   undefined                  → 尚未加载
 *
 * main chunk 是入口文件自身，天然已就绪
 */
var installedChunks = {
  main: 0,
};

// ================================================================
// require.p — 资源公共路径（__webpack_require__.p，对应 output.publicPath）
// ================================================================
require.p = "";

// ================================================================
// require.u — chunkId 到文件名的映射（__webpack_require__.u）
// ================================================================
/**
 * webpack 编译时会根据配置生成此函数
 * 将 chunkId 映射为实际的文件名（可能包含 contenthash）
 */
require.u = function (chunkId) {
  return chunkId + ".main.js";
};

// ================================================================
// require.l — 通用脚本加载器（__webpack_require__.l）
// ================================================================
/**
 * 通过创建 <script> 标签加载远程 JS 文件
 * 特点：onload 和 onerror 统一走同一个回调 done
 *
 * 真实 webpack 中还有更多逻辑：URL 去重（inProgress map）、超时控制、
 * nonce/crossOrigin 设置等，此处简化
 */
require.l = function (url, done) {
  var script = document.createElement("script");
  script.src = url;

  var onScriptComplete = function (event) {
    // 清理事件监听，防止 onload/onerror 重复触发
    script.onerror = script.onload = null;
    done(event);
  };

  script.onerror = onScriptComplete;
  script.onload = onScriptComplete;
  document.head.appendChild(script);
};

// ================================================================
// require.f — 异步加载策略注册表（__webpack_require__.f）
// ================================================================
/**
 * 【核心设计】webpack 采用策略模式管理不同类型的异步资源加载：
 *   require.f.j        → JSONP 方式加载 JS chunk（webpack 内置）
 *   require.f.miniCss  → 加载 CSS chunk（MiniCssExtractPlugin 注入）
 *   require.f.prefetch → 预取未来可能需要的 chunk（简化演示）
 *
 * require.e 不关心具体加载方式，只负责遍历所有策略并收集 promise
 * 这种设计使得 chunk 加载机制可扩展
 */
require.f = {};

// ================================================================
// require.e — 异步加载入口（__webpack_require__.e）
// ================================================================
/**
 * 对应 import() 编译后的异步加载入口
 * 遍历 require.f 中注册的所有加载策略，收集 promise，等待全部完成
 *
 * 为什么用 reduce 而不是直接调用 require.f.j？
 * → 因为一个 chunk 可能需要同时加载 JS 和 CSS 等多种资源
 *   每种资源有各自的加载策略，require.e 统一编排
 */
require.e = function (chunkId) {
  return Promise.all(
    Object.keys(require.f).reduce(function (promises, key) {
      require.f[key](chunkId, promises);
      return promises;
    }, []),
  );
};

// ================================================================
// require.f.j — JSONP 加载策略（__webpack_require__.f.j）
// ================================================================
/**
 * 通过 JSONP（动态 script 标签）方式加载 JS chunk
 *
 * 三种状态分支：
 *   installedChunks[chunkId] === 0     → 已加载，跳过
 *   installedChunks[chunkId] 为数组     → 加载中，复用已有 promise
 *   installedChunks[chunkId] undefined → 首次加载，创建 promise + script
 */
require.f.j = function (chunkId, promises) {
  var installedChunkData = installedChunks[chunkId];

  if (installedChunkData === 0) {
    // chunk 已加载完成，无需任何操作
    return;
  }

  if (installedChunkData) {
    // chunk 正在加载中，复用已有的 promise（第三个元素）
    promises.push(installedChunkData[2]);
    return;
  }

  // ---- chunk 尚未加载，开始加载流程 ----

  // 1. 创建 promise，并将 [resolve, reject] 存入 installedChunks
  var promise = new Promise(function (resolve, reject) {
    installedChunkData = installedChunks[chunkId] = [resolve, reject];
  });
  // 2. 将 promise 作为第三个元素存入，形成 [resolve, reject, promise] 三元组
  promises.push((installedChunkData[2] = promise));

  // 3. 拼接 chunk 文件 URL
  var url = require.p + require.u(chunkId);

  // 4. 定义加载完成回调（onload 和 onerror 共用）
  var loadingEnded = function (event) {
    if (require.o(installedChunks, chunkId)) {
      installedChunkData = installedChunks[chunkId];
      // 如果到这里 installedChunkData 仍不为 0，说明 webpackJsonpCallback 没有被调用
      // 两种情况：
      //   event.type === "load"  → 脚本加载成功但内容不包含预期的 chunk（missing）
      //   event.type === "error" → 网络错误，脚本加载失败
      if (installedChunkData !== 0) {
        installedChunks[chunkId] = undefined; // 重置状态，允许重试
      }
      if (installedChunkData) {
        var errorType = event && (event.type === "load" ? "missing" : event.type);
        var realSrc = event && event.target && event.target.src;
        var error = new Error("Loading chunk " + chunkId + " failed.\n(" + errorType + ": " + realSrc + ")");
        error.type = errorType;
        error.request = realSrc;
        installedChunkData[1](error); // 调用 reject
      }
    }
  };

  // 5. 通过通用脚本加载器加载
  require.l(url, loadingEnded);
};

// ================================================================
// require.f.miniCss — CSS chunk 加载策略（MiniCssExtractPlugin 注入）
// ================================================================
/**
 * 当使用 MiniCssExtractPlugin 将 CSS 提取为独立文件时，
 * 插件会在 webpack 运行时中注入此策略
 *
 * 与 require.f.j 的对比：
 *   相同点：三态模式（已加载 0 / 加载中 [r,j,p] / 未加载 undefined）
 *   不同点：
 *     - 载体是 <link rel="stylesheet"> 而非 <script>
 *     - 有独立的状态表 installedCssChunks（不与 JS 共用）
 *     - CSS 没有 JSONP 回调机制，而是靠 link.onload 直接 resolve
 *     - 需要通过 cssChunksMap 判断该 chunk 是否包含 CSS
 */

// CSS chunk 的加载状态表（独立于 JS 的 installedChunks）
var installedCssChunks = { main: 0 };

// chunkId → CSS 文件名映射（对应 __webpack_require__.miniCssF）
require.miniCssF = function (chunkId) {
  return chunkId + ".main.css";
};

// 编译时确定哪些 chunk 包含 CSS 资源（由 MiniCssExtractPlugin 注入）
// 示例：src_test_js chunk 包含 CSS，src_utils_js 不包含
var cssChunksMap = { src_test_js: 1 };

require.f.miniCss = function (chunkId, promises) {
  // 如果该 chunk 不包含 CSS 资源，直接跳过，不 push 任何 promise
  if (!cssChunksMap[chunkId]) return;

  var installedChunkData = installedCssChunks[chunkId];

  if (installedChunkData === 0) return;

  if (installedChunkData) {
    promises.push(installedChunkData[2]);
    return;
  }

  var promise = new Promise(function (resolve, reject) {
    installedChunkData = installedCssChunks[chunkId] = [resolve, reject];
  });
  promises.push((installedChunkData[2] = promise));

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = require.p + require.miniCssF(chunkId);

  // 与 JS 不同：CSS 没有 JSONP callback 机制
  // 直接依赖 link.onload / link.onerror 判断加载结果
  link.onload = function () {
    installedCssChunks[chunkId] = 0;
    installedChunkData[0](); // resolve
  };
  link.onerror = function (event) {
    installedCssChunks[chunkId] = undefined; // 重置，允许重试
    var realHref = event && event.target && event.target.href;
    var error = new Error("Loading CSS chunk " + chunkId + " failed.\n(" + realHref + ")");
    installedChunkData[1](error); // reject
  };

  document.head.appendChild(link);
};

// ================================================================
// require.f.prefetch — 预取策略
// ================================================================
/**
 * 对应源码中的 import(/* webpackPrefetch: true *\/ "./xxx.js") 魔法注释
 *
 * 【注意】真实 webpack 中预取使用的是 __webpack_require__.F（大写 F），
 * 并且是在父 chunk 加载完成后才触发，而非 require.f 策略。
 * 此处简化为 require.f 处理器，以便在同一注册表中统一理解所有加载行为。
 *
 * 核心特点：
 *   1. 不阻塞当前加载 — 不往 promises 中 push 任何东西
 *   2. 只是浏览器的"提示" — 创建 <link rel="prefetch">
 *   3. 浏览器在空闲时下载资源存入 HTTP 缓存
 *   4. 后续 require.e 真正加载时命中缓存，实现"秒加载"
 *
 * prefetch vs preload 的区别：
 *   prefetch → 未来可能需要，优先级低，空闲时加载
 *   preload  → 当前页面一定需要，优先级高，立即加载
 */

// 编译时确定的预取映射：加载 chunkA 时，顺便预取 [chunkB, chunkC, ...]
// 示例：加载 src_test_js 时预取 src_utils_js（用户未来可能会用到）
var prefetchMap = { src_test_js: ["src_utils_js"] };

// 记录已经预取过的 chunk，避免重复创建 <link> 标签
var prefetchedChunks = {};

require.f.prefetch = function (chunkId, promises) {
  // 注意：不往 promises 里 push！预取不应阻塞当前 chunk 的加载
  var chunksToPrefetch = prefetchMap[chunkId];
  if (!chunksToPrefetch) return;

  for (var i = 0; i < chunksToPrefetch.length; i++) {
    var prefetchId = chunksToPrefetch[i];

    // 已加载完成或已发起预取的，跳过
    if (installedChunks[prefetchId] === 0) continue;
    if (prefetchedChunks[prefetchId]) continue;

    prefetchedChunks[prefetchId] = true;

    var link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "script"; // 告诉浏览器预取的资源类型是脚本
    link.href = require.p + require.u(prefetchId);
    document.head.appendChild(link);
  }
};

// ================================================================
// require.O — 延迟执行队列（__webpack_require__.O）
// ================================================================
/**
 * 【重要】处理入口 chunk 依赖共享 chunk 的场景（splitChunks 优化）
 *
 * 问题场景：
 *   webpack 将 lodash 等公共依赖拆分到 vendors.js（splitChunks 优化）
 *   HTML 中两个 <script> 标签并行加载：
 *     <script src="vendors.main.js" defer></script>
 *     <script src="main.js" defer></script>
 *
 *   main.js 可能先于 vendors.js 执行完毕
 *   此时入口代码不能立即运行（依赖的模块还没注册到 modules 中）
 *
 * 解决机制：
 *   1. main.js 末尾调用 require.O(undefined, ["vendors"], factory)
 *      → 将入口代码注册为"延迟任务"，记录它依赖 vendors chunk
 *   2. vendors.js 加载完成 → webpackJsonpCallback 将模块合并并设置
 *      installedChunks["vendors"] = 0
 *   3. webpackJsonpCallback 末尾调用 require.O() 检查延迟队列
 *      → 发现 vendors 已就绪 → 执行入口 factory 函数
 *
 * 与 import() 的区别：
 *   import() → 用 Promise 异步等待，对应 require.e
 *   splitChunks 入口 → 用延迟队列同步轮询，对应 require.O
 *
 * @param {any}     result   - 传递执行结果（用于链式调用）
 * @param {Array}   chunkIds - 依赖的 chunk ID 列表（注册模式）
 * @param {Function} fn      - 满足条件后执行的工厂函数
 * @param {number}  priority - 执行优先级（数字越小越优先）
 */
var deferred = [];

require.O = function (result, chunkIds, fn, priority) {
  if (chunkIds) {
    // ---- 注册模式 ----
    // 将 [chunkIds, fn, priority] 按优先级插入延迟队列
    priority = priority || 0;
    var i = deferred.length;
    for (; i > 0 && deferred[i - 1][2] > priority; i--) {
      deferred[i] = deferred[i - 1]; // 右移，腾出插入位置
    }
    deferred[i] = [chunkIds, fn, priority];
    return;
  }

  // ---- 检查模式（无 chunkIds 参数）----
  // 遍历延迟队列，找出所有依赖已满足的任务并执行
  var notFulfilled = Infinity;
  for (var i = 0; i < deferred.length; i++) {
    var deferredItem = deferred[i];
    var deferredChunkIds = deferredItem[0];
    var deferredFn = deferredItem[1];
    var deferredPriority = deferredItem[2];
    var fulfilled = true;

    for (var j = 0; j < deferredChunkIds.length; j++) {
      // 通过 require.O 上挂载的检查函数判断每个 chunk 是否就绪
      // require.O.j 检查 JS chunk 状态
      if (
        (deferredPriority & 1 === 0 || notFulfilled >= deferredPriority) &&
        Object.keys(require.O).every(function (key) {
          return require.O[key](deferredChunkIds[j]);
        })
      ) {
        deferredChunkIds.splice(j--, 1); // 该 chunk 已就绪，从依赖列表移除
      } else {
        fulfilled = false;
        if (deferredPriority < notFulfilled) notFulfilled = deferredPriority;
      }
    }

    if (fulfilled) {
      deferred.splice(i--, 1); // 所有依赖满足，从队列移除
      var r = deferredFn(); // 执行入口工厂函数
      if (r !== undefined) result = r;
    }
  }
  return result;
};

/**
 * require.O.j — JS chunk 就绪检查函数
 * 挂载在 require.O 上，被检查模式遍历调用
 * 判断依据：installedChunks[chunkId] === 0 表示已加载完成
 */
require.O.j = function (chunkId) {
  return installedChunks[chunkId] === 0;
};

// ================================================================
// webpackJsonpCallback — JSONP 核心回调
// ================================================================
/**
 * 异步 chunk 文件加载完成后被调用
 *
 * chunk 文件内容形如：
 *   (self.webpackChunkstudy = self.webpackChunkstudy || []).push([
 *     ["src_test_js"],                           // chunkIds
 *     { "./src/test.js": function(m, e, r) {} }, // moreModules
 *     function(require) { ... }                  // runtime（可选）
 *   ])
 *
 * 参数说明：
 * @param {Function|0} parentChunkLoadingFunction
 *   用于多 webpack 运行时共存时的链式调用
 *   通过 bind(null, 0) 绑定时传入 0（falsy），表示无需链式调用
 * @param {Array} data - [chunkIds, moreModules, runtime?]
 */
function webpackJsonpCallback(parentChunkLoadingFunction, data) {
  var chunkIds = data[0];
  var moreModules = data[1];
  var runtime = data[2]; // 可选的运行时初始化函数

  var i = 0;

  // 1. 收集需要 resolve 的 chunk
  //    同时将 installedChunks 标记为 0（已完成）
  for (; i < chunkIds.length; i++) {
    var chunkId = chunkIds[i];
    if (require.o(installedChunks, chunkId) && installedChunks[chunkId]) {
      // installedChunks[chunkId][0] 就是 resolve 函数
      installedChunks[chunkId][0]();
    }
    installedChunks[chunkId] = 0;
  }

  // 2. 将新模块工厂函数合并到全局 modules
  for (var moduleId in moreModules) {
    if (require.o(moreModules, moduleId)) {
      modules[moduleId] = moreModules[moduleId];
    }
  }

  // 3. 执行可选的 runtime 函数（用于初始化额外的 require 方法）
  if (runtime) runtime(require);

  // 4. 链式调用：如果存在父级加载函数，继续传递数据
  //    （多 webpack 运行时共存场景）
  if (parentChunkLoadingFunction) parentChunkLoadingFunction(data);

  // 5. 检查延迟执行队列
  //    某些入口代码（splitChunks 场景）可能正在等待这些 chunk 就绪
  //    每次有 chunk 加载完成都要重新检查队列
  return require.O();
}

// ================================================================
// 劫持全局变量的 push 方法 + 竞态处理
// ================================================================
/**
 * 【关键】这段代码同时处理了两个问题：
 *
 * 1. 劫持 push：将 push 替换为 webpackJsonpCallback
 *    之后异步 chunk 脚本调用 push(...) 时，实际执行的是 webpackJsonpCallback
 *
 * 2. 竞态处理（Race Condition）：
 *    如果异步 chunk 的 <script> 在主入口脚本之前加载完成，
 *    那么 push 还未被劫持，数据会以普通 Array.push 的方式存入数组。
 *    所以这里要先用 forEach 遍历数组，处理这些"提前到达"的 chunk 数据。
 *
 * bind(null, 0) 的含义：
 *   将 parentChunkLoadingFunction 参数绑定为 0（falsy）
 *   因为当前场景不需要链式调用
 */
var chunkLoadingGlobal = (self.webpackChunkstudy = self.webpackChunkstudy || []);
// 处理可能已提前到达的 chunk 数据
chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
// 劫持 push，后续的 push 调用都会走 webpackJsonpCallback
chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, 0);

// ================================================================
// 业务代码（webpack 编译后的入口文件）
// ================================================================
/**
 * 编译前的源码：
 *
 *   const buttonEle = document.getElementById("button");
 *   buttonEle.onclick = () => {
 *     import("./src/test.js").then(module => {
 *       module.default();
 *     });
 *   };
 *
 * webpack 将 import() 编译为 require.e + require 的组合调用：
 *   1. require.e("src_test_js")  → 异步加载 chunk
 *   2. .then(require.bind(...))  → chunk 就绪后同步 require 模块
 *   3. .then(module => ...)      → 使用模块导出
 */
var buttonEle = document.getElementById("button");
buttonEle.onclick = function () {
  require
    .e("src_test_js")
    .then(require.bind(require, "./src/test.js"))
    .then(function (module) {
      var print = module.default;
      print();
    });
};

// ================================================================
// 附录：splitChunks 场景下入口代码如何使用 require.O
// ================================================================
/**
 * 当 webpack 配置了 optimization.splitChunks，公共依赖被拆分为独立 chunk 时，
 * HTML 中会有多个并行加载的 <script> 标签：
 *
 *   <script src="vendors.main.js" defer></script>
 *   <script src="main.js" defer></script>
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  vendors.main.js 内容：                              │
 * │                                                     │
 * │  (self.webpackChunkstudy = self.webpackChunkstudy   │
 * │    || []).push([                                    │
 * │    ["vendors"],                                     │
 * │    {                                                │
 * │      "./node_modules/lodash/lodash.js":             │
 * │        function(module, exports) { ... }            │
 * │    }                                                │
 * │  ]);                                                │
 * └─────────────────────────────────────────────────────┘
 *
 * main.js 末尾（在所有运行时代码之后）会生成以下入口代码：
 */

// var __webpack_exports__ = require.O(
//   undefined,     // result 初始值
//   ["vendors"],   // 依赖的 chunk ID 列表
//   function () {  // 入口工厂函数（所有依赖就绪后执行）
//     return require("./src/index.js");
//   },
//   1              // 优先级
// );
//
// // 注册完毕后立即检查一次
// // （如果 vendors.js 碰巧先加载完成，这里就能直接执行入口）
// __webpack_exports__ = require.O(__webpack_exports__);
