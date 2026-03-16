/**
 * Code Splitting（代码分割）编译实现
 *
 * ═══════════════════════════════════════════════════════
 *  本文件与 async-loader-demo.js 的关系
 * ═══════════════════════════════════════════════════════
 *
 *  async-loader-demo.js = 运行时视角（chunk 加载后发生了什么）
 *  code-splitting-demo.js = 编译时视角（编译器如何拆分 chunk）
 *  两者合在一起 = 完整的 import() 实现
 *
 * ═══════════════════════════════════════════════════════
 *  webpack 编译时做了什么？
 * ═══════════════════════════════════════════════════════
 *
 *  源码：
 *    import('./lazy').then(m => m.hello());
 *
 *  编译后拆成两个文件：
 *
 *  main.js（主 chunk）：
 *    - 入口 + 所有同步 require() 依赖
 *    - import() 被替换为 require.e("chunk-lazy").then(require.bind(require, "./lazy.js"))
 *    - 注入 JSONP 异步加载运行时（require.e / require.f.j / webpackJsonpCallback）
 *
 *  chunk-lazy.js（异步 chunk）：
 *    - JSONP 格式：self.webpackChunk.push([["chunk-lazy"], { modules }])
 *    - 包含 lazy.js 及其同步依赖
 *
 * ═══════════════════════════════════════════════════════
 *  编译阶段的 4 个关键步骤
 * ═══════════════════════════════════════════════════════
 *
 *  1. AST 遍历时识别 import() 调用（callee.type === 'Import'）
 *  2. 将 import() 目标模块 + 其依赖抽到独立 chunk
 *  3. 将 import('./xxx') 替换为 require.e("chunkName").then(...)
 *  4. 主 chunk 注入 JSONP 运行时，异步 chunk 用 JSONP 格式包裹
 *
 * ═══════════════════════════════════════════════════════
 *  简化点
 * ═══════════════════════════════════════════════════════
 *
 *  - import() 只支持字符串字面量参数
 *  - 不处理异步 chunk 之间的共享模块（真实 webpack 用 splitChunks 优化）
 *  - 运行时代码硬编码（真实 webpack 按需注入）
 *
 * 运行方式：cd WebPack/mini-webpack && npm install && cd .. && node code-splitting-demo.js
 * 产出目录：WebPack/code-splitting-dist/（可在浏览器中打开 index.html 测试）
 */

const fs = require("fs");
const path = require("path");
// 复用 mini-webpack 的 babel 依赖
const parser = require("./mini-webpack/node_modules/@babel/parser");
const traverse = require("./mini-webpack/node_modules/@babel/traverse").default;
const generator = require("./mini-webpack/node_modules/@babel/generator").default;
const types = require("./mini-webpack/node_modules/@babel/types");

// ─── 示例源码 ───────────────────────────────────────────────────────────────

const files = {
  "./src/index.js": `
const greeting = require('./greeting');
console.log(greeting('World'));

import('./lazy-module').then(function(m) {
  console.log(m.hello());
});

import('./lazy-utils').then(function(utils) {
  console.log(utils.format('webpack'));
});
`,
  "./src/greeting.js": `
module.exports = function(name) { return 'Hello, ' + name + '!'; };
`,
  // lazy-module 有自己的依赖 lazy-helper，两者会被打入同一个 async chunk
  "./src/lazy-module.js": `
const helper = require('./lazy-helper');
module.exports = { hello: function() { return helper.prefix() + 'I am lazy-loaded!'; } };
`,
  "./src/lazy-helper.js": `
module.exports = { prefix: function() { return '[Lazy] '; } };
`,
  "./src/lazy-utils.js": `
module.exports = { format: function(name) { return '<<< ' + name.toUpperCase() + ' >>>'; } };
`,
};

// ─── 工具 ────────────────────────────────────────────────────────────────────

function resolveModule(importPath) {
  let r = importPath;
  if (!r.startsWith("./src/")) r = "./src/" + r.replace("./", "");
  if (!r.endsWith(".js")) r += ".js";
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 1：构建依赖图 + 识别 import() 分割点
// ═══════════════════════════════════════════════════════════════════════════
//
// 遍历入口的 AST 并区分两类依赖：
//   require() → 同步依赖，归入主 chunk
//   import()  → 动态依赖，创建新的 async chunk
//
// 对应 webpack 源码：
//   ImportParserPlugin   → 识别 import() 调用
//   Compilation.addModuleChain() → 为 import() 目标创建新的 chunk group

function buildDependencyGraph(entryId) {
  const syncModules = {};
  const asyncChunks = [];
  const visited = new Set();

  // 递归构建同步依赖，收集 import() 分割点
  function buildModule(moduleId, container, dynamicImports) {
    if (visited.has(moduleId)) return;
    visited.add(moduleId);

    const source = files[moduleId];
    if (!source) throw new Error("模块未找到: " + moduleId);

    const ast = parser.parse(source, {
      sourceType: "module",
      plugins: ["dynamicImport"],
    });

    const syncDeps = [];

    traverse(ast, {
      CallExpression(nodePath) {
        const { node } = nodePath;

        // ── require() 同步依赖 ──────────────────────────────────────
        if (node.callee.name === "require" && node.callee.type === "Identifier") {
          const depName = node.arguments[0]?.value;
          if (typeof depName !== "string") return;
          const depId = resolveModule(depName);
          node.arguments = [types.stringLiteral(depId)];
          syncDeps.push(depId);
        }

        // ── import() 动态依赖 ───────────────────────────────────────
        //
        // import('./lazy-module') 在 AST 中的表示：
        //   CallExpression { callee: Import {}, arguments: [StringLiteral] }
        //
        // 需要替换为：
        //   require.e("chunk-lazy-module")
        //     .then(require.bind(require, "./src/lazy-module.js"))
        //
        // require.e → 触发异步加载（JSONP），返回 Promise
        // .then(require.bind(...)) → chunk 就绪后同步 require 模块
        //
        // 用 require.bind 而非箭头函数是因为体积更小（webpack 的做法）
        if (node.callee.type === "Import") {
          const depName = node.arguments[0]?.value;
          if (typeof depName !== "string") return;
          const depId = resolveModule(depName);
          const chunkName = "chunk-" + path.basename(depId, ".js");
          dynamicImports.push({ depId, chunkName });

          // 构造 require.e("chunkName").then(require.bind(require, depId))
          const eCall = types.callExpression(
            types.memberExpression(types.identifier("require"), types.identifier("e")),
            [types.stringLiteral(chunkName)]
          );
          const bindCall = types.callExpression(
            types.memberExpression(types.identifier("require"), types.identifier("bind")),
            [types.identifier("require"), types.stringLiteral(depId)]
          );
          nodePath.replaceWith(
            types.callExpression(
              types.memberExpression(eCall, types.identifier("then")),
              [bindCall]
            )
          );
        }
      },
    });

    container[moduleId] = generator(ast).code;
    syncDeps.forEach((dep) => buildModule(dep, container, dynamicImports));
  }

  const dynamicImports = [];
  buildModule(entryId, syncModules, dynamicImports);

  // ── 为每个 import() 构建独立的 async chunk ──────────────────────────
  dynamicImports.forEach(({ depId, chunkName }) => {
    const chunkModules = {};
    const chunkVisited = new Set();

    function buildChunkModule(moduleId) {
      if (chunkVisited.has(moduleId)) return;
      chunkVisited.add(moduleId);

      const source = files[moduleId];
      if (!source) throw new Error("模块未找到: " + moduleId);

      const ast = parser.parse(source, { sourceType: "module" });
      const deps = [];

      traverse(ast, {
        CallExpression({ node }) {
          if (node.callee.name === "require" && node.callee.type === "Identifier") {
            const depName = node.arguments[0]?.value;
            if (typeof depName !== "string") return;
            const dep = resolveModule(depName);
            node.arguments = [types.stringLiteral(dep)];
            deps.push(dep);
          }
        },
      });

      chunkModules[moduleId] = generator(ast).code;
      deps.forEach((d) => buildChunkModule(d));
    }

    buildChunkModule(depId);
    asyncChunks.push({ chunkName, modules: chunkModules });
  });

  return { syncModules, asyncChunks };
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 2：生成主 chunk
// ═══════════════════════════════════════════════════════════════════════════
//
// 主 chunk = 同步模块 + require 运行时 + 异步加载运行时
//
// 异步加载运行时的调用链（与 async-loader-demo.js 完全对应）：
//   require.e("chunk-xxx")
//     → require.f.j("chunk-xxx", promises)
//       → require.l(url)               创建 <script>
//         → 脚本执行 self.webpackChunk.push(...)
//           → webpackJsonpCallback      合并模块 + resolve
//     → Promise.all(promises)
//       → require("./src/xxx.js")       同步取模块

function generateMainChunk(syncModules, asyncChunks, entryId) {
  const chunkFileMap = {};
  asyncChunks.forEach(({ chunkName }) => {
    chunkFileMap[chunkName] = chunkName + ".js";
  });

  const moduleEntries = Object.entries(syncModules)
    .map(([id, code]) => {
      const indented = code.split("\n").map((l) => "      " + l).join("\n");
      return `    "${id}": (module, exports, require) => {\n${indented}\n    }`;
    })
    .join(",\n");

  return `/* ===== main.js ===== */
(() => {

  var modules = {
${moduleEntries}
  };

  var cache = {};

  function require(moduleId) {
    if (cache[moduleId]) return cache[moduleId].exports;
    var module = (cache[moduleId] = { exports: {} });
    modules[moduleId](module, module.exports, require);
    return module.exports;
  }

  /* ---- 异步加载运行时 ----
   *
   * installedChunks 状态：
   *   0                          → 已加载
   *   [resolve, reject, promise] → 加载中
   *   undefined                  → 未加载
   */
  var installedChunks = { main: 0 };

  require.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

  require.u = function(chunkId) {
    return ${JSON.stringify(chunkFileMap)}[chunkId] || (chunkId + ".js");
  };

  require.p = "";

  require.l = function(url, done) {
    var script = document.createElement("script");
    script.src = url;
    script.onload = script.onerror = function(e) {
      script.onload = script.onerror = null;
      done(e);
    };
    document.head.appendChild(script);
  };

  require.f = {};

  require.e = function(chunkId) {
    return Promise.all(
      Object.keys(require.f).reduce(function(promises, key) {
        require.f[key](chunkId, promises);
        return promises;
      }, [])
    );
  };

  /* ---- JSONP 加载策略 ---- */
  require.f.j = function(chunkId, promises) {
    var data = installedChunks[chunkId];
    if (data === 0) return;
    if (data) { promises.push(data[2]); return; }

    var promise = new Promise(function(resolve, reject) {
      data = installedChunks[chunkId] = [resolve, reject];
    });
    promises.push(data[2] = promise);

    require.l(require.p + require.u(chunkId), function(event) {
      if (require.o(installedChunks, chunkId)) {
        data = installedChunks[chunkId];
        if (data !== 0) installedChunks[chunkId] = undefined;
        if (data) {
          var err = new Error("Loading chunk " + chunkId + " failed.(" + event.type + ")");
          data[1](err);
        }
      }
    });
  };

  /* ---- webpackJsonpCallback ---- */
  function webpackJsonpCallback(parentFn, data) {
    var chunkIds = data[0], moreModules = data[1];
    for (var i = 0; i < chunkIds.length; i++) {
      if (require.o(installedChunks, chunkIds[i]) && installedChunks[chunkIds[i]])
        installedChunks[chunkIds[i]][0]();          // resolve
      installedChunks[chunkIds[i]] = 0;
    }
    for (var id in moreModules)
      if (require.o(moreModules, id)) modules[id] = moreModules[id];
    if (parentFn) parentFn(data);
  }

  var g = self.webpackChunk = self.webpackChunk || [];
  g.forEach(webpackJsonpCallback.bind(null, 0));
  g.push = webpackJsonpCallback.bind(null, 0);

  require("${entryId}");
})();
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 3：生成异步 chunk（JSONP 格式）
// ═══════════════════════════════════════════════════════════════════════════
//
// 格式：
//   (self.webpackChunk = self.webpackChunk || []).push([
//     ["chunk-lazy-module"],
//     { "./src/lazy-module.js": (module, exports, require) => { ... } }
//   ]);
//
// 为什么用 JSONP 而非 fetch + eval？
//   1. <script> 天然跨域，不需要 CORS 配置
//   2. 不触发 CSP 对 eval 的限制
//   3. push 被劫持为 webpackJsonpCallback，天然实现了"加载完成回调"

function generateAsyncChunk(chunkName, chunkModules) {
  const entries = Object.entries(chunkModules)
    .map(([id, code]) => {
      const indented = code.split("\n").map((l) => "      " + l).join("\n");
      return `    "${id}": (module, exports, require) => {\n${indented}\n    }`;
    })
    .join(",\n");

  return `/* ===== ${chunkName}.js ===== */
(self.webpackChunk = self.webpackChunk || []).push([
  ["${chunkName}"],
  {
${entries}
  }
]);
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 执行
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Code Splitting 编译演示 ===\n");

const entryId = "./src/index.js";
const { syncModules, asyncChunks } = buildDependencyGraph(entryId);

console.log("主 chunk（同步模块）：");
Object.keys(syncModules).forEach((id) => console.log("  " + id));

console.log("\n异步 chunks：");
asyncChunks.forEach(({ chunkName, modules }) => {
  console.log("  " + chunkName + ".js →", Object.keys(modules).join(", "));
});

// 生成产物
const mainBundle = generateMainChunk(syncModules, asyncChunks, entryId);
const asyncBundles = {};
asyncChunks.forEach(({ chunkName, modules }) => {
  asyncBundles[chunkName + ".js"] = generateAsyncChunk(chunkName, modules);
});

// 写入文件
const outDir = path.resolve(__dirname, "code-splitting-dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, "main.js"), mainBundle);
for (const [name, content] of Object.entries(asyncBundles)) {
  fs.writeFileSync(path.join(outDir, name), content);
}

fs.writeFileSync(
  path.join(outDir, "index.html"),
  `<!DOCTYPE html>
<html><head><title>Code Splitting Demo</title></head>
<body>
<h1>Code Splitting Demo</h1>
<p>打开控制台查看输出：同步模块立即执行，异步模块通过 JSONP 延迟加载</p>
<script src="main.js"></script>
</body></html>`
);

console.log("\n产出文件已写入 " + outDir + "/");
console.log("  main.js        ← 入口 + 同步依赖 + 异步加载运行时");
asyncChunks.forEach(({ chunkName }) => {
  console.log(`  ${chunkName}.js  ← 异步 chunk（JSONP 格式）`);
});
console.log("  index.html     ← 浏览器测试页面\n");

// 打印产物内容
console.log("==================== main.js ====================");
console.log(mainBundle);
asyncChunks.forEach(({ chunkName }) => {
  console.log(`==================== ${chunkName}.js ====================`);
  console.log(asyncBundles[chunkName + ".js"]);
});

console.log("关键转换：");
console.log("  源码:    import('./lazy-module').then(m => m.hello())");
console.log('  编译后:  require.e("chunk-lazy-module").then(require.bind(require, "./src/lazy-module.js")).then(m => m.hello())');
