/**
 * Loader 完整生命周期（Pitch 阶段 + Async Loader）
 *
 * ═══════════════════════════════════════════════════════
 *  mini-webpack 已实现的部分
 * ═══════════════════════════════════════════════════════
 *
 * mini-webpack 的 loader 只实现了 Normal 阶段（从右到左）：
 *   use: [A, B, C]
 *   → C(source) → B(result) → A(result)
 *
 * 这对于大多数 loader（babel-loader、ts-loader）足够了。
 * 但 style-loader 等"注入型" loader 依赖一个更复杂的机制：Pitch 阶段。
 *
 * ═══════════════════════════════════════════════════════
 *  真实 webpack 的 Loader 执行流程
 * ═══════════════════════════════════════════════════════
 *
 *  配置：use: [style-loader, css-loader, sass-loader]
 *
 *  阶段 1 — Pitch（从左到右）：
 *    style-loader.pitch(remainingRequest, previousRequest, data)
 *      ↓ 无返回值，继续
 *    css-loader.pitch(remainingRequest, previousRequest, data)
 *      ↓ 无返回值，继续
 *    sass-loader.pitch(remainingRequest, previousRequest, data)
 *      ↓ 无返回值，Pitch 阶段结束
 *
 *  阶段 2 — 读取源文件
 *
 *  阶段 3 — Normal（从右到左）：
 *    sass-loader(source)  → CSS 字符串
 *    css-loader(css)      → JS 模块（exports CSS）
 *    style-loader(js)     → JS 模块（注入 <style> 标签）
 *
 * ═══════════════════════════════════════════════════════
 *  Pitch 的"熔断"机制（关键！）
 * ═══════════════════════════════════════════════════════
 *
 *  如果某个 loader 的 pitch 函数有返回值，则：
 *    1. 跳过后续所有 loader 的 pitch
 *    2. 跳过读取源文件
 *    3. 跳过后续所有 loader 的 normal
 *    4. 将 pitch 的返回值作为上一个 loader 的输入
 *
 *  示例：css-loader.pitch() 返回了内容
 *
 *    style-loader.pitch()  → 无返回值，继续
 *    css-loader.pitch()    → 返回 "处理后的内容"  ← 熔断！
 *    ╳ sass-loader.pitch() → 跳过
 *    ╳ 读取源文件           → 跳过
 *    ╳ sass-loader()       → 跳过
 *    ╳ css-loader()        → 跳过
 *    style-loader("处理后的内容")  ← pitch 的返回值传给上一个 loader 的 normal
 *
 *  这就是 style-loader 的工作原理：
 *    style-loader.pitch() 返回一段 JS 代码，
 *    这段 JS require 了 css-loader 的处理结果，并将其注入到 <style> 标签中。
 *    因此 style-loader 的 normal 函数根本不需要执行。
 *
 * ═══════════════════════════════════════════════════════
 *  Async Loader
 * ═══════════════════════════════════════════════════════
 *
 *  默认 loader 是同步的：return 转换后的代码。
 *  但有些 loader 需要异步操作（如读取文件、网络请求、调用子编译器）。
 *
 *  两种方式让 loader 变成异步：
 *    1. this.async()  → 返回一个 callback(err, result)，调用它表示完成
 *    2. 返回 Promise  → resolve 时表示完成
 *
 * 运行方式：node loader-pipeline-demo.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// LoaderRunner 实现
// ═══════════════════════════════════════════════════════════════════════════
//
// 这个类对应 webpack 依赖的 loader-runner 包。
// 它管理 Loader 的完整执行流程：pitch → 读文件 → normal。

class LoaderRunner {
  /**
   * @param {object[]}  loaders    loader 数组，每个 loader 是 { normal, pitch?, name }
   * @param {string}    resource   被处理的文件路径
   * @param {Function}  readFile   读取文件的函数（source = readFile(path)）
   * @param {Function}  callback   最终回调 (err, result)
   */
  static run({ loaders, resource, readFile, callback }) {
    // 为每个 loader 创建上下文对象
    // webpack 中 loader 通过 this 访问 loaderContext（如 this.async()）
    const loaderContexts = loaders.map((loader, index) => ({
      name: loader.name || `loader${index}`,
      normal: loader.normal || null,
      pitch: loader.pitch || null,
      data: {}, // pitch 和 normal 之间共享的数据对象
      async: false, // 标记是否调用了 this.async()
      _callback: null, // this.async() 返回的 callback
    }));

    let loaderIndex = 0; // 当前执行到第几个 loader
    let currentPhase = "pitch"; // 当前阶段："pitch" 或 "normal"
    const logs = []; // 收集执行日志（用于演示输出）

    // ── Pitch 阶段（从左到右）──────────────────────────────────────────

    function iteratePitch() {
      if (loaderIndex >= loaderContexts.length) {
        // 所有 pitch 执行完毕，进入"读文件"阶段
        processResource();
        return;
      }

      const ctx = loaderContexts[loaderIndex];

      if (!ctx.pitch) {
        // 没有 pitch 函数，跳到下一个
        loaderIndex++;
        iteratePitch();
        return;
      }

      logs.push(`  Pitch → ${ctx.name}.pitch()`);

      // pitch 的参数：
      //   remainingRequest: 当前 loader 后面的所有 loader + 资源路径
      //   previousRequest: 当前 loader 前面的所有 loader
      //   data: pitch 和 normal 之间共享的数据对象
      const remaining = loaderContexts
        .slice(loaderIndex + 1)
        .map((l) => l.name)
        .concat(resource)
        .join("!");
      const previous = loaderContexts
        .slice(0, loaderIndex)
        .map((l) => l.name)
        .join("!");

      // 构造 loaderContext（loader 中的 this）
      const thisArg = createLoaderContext(ctx);

      const result = ctx.pitch.call(thisArg, remaining, previous, ctx.data);

      if (thisArg._isAsync) {
        // 异步 pitch：等 callback 调用
        return;
      }

      handlePitchResult(result);
    }

    function handlePitchResult(result) {
      if (result !== undefined && result !== null) {
        // ── Pitch 熔断 ────────────────────────────────────────────────
        // 有返回值 → 跳过后续 pitch + 读文件 + 后续 normal
        // 将返回值传给上一个 loader 的 normal
        logs.push(`  Pitch 熔断！${loaderContexts[loaderIndex].name}.pitch() 返回了内容`);
        loaderIndex--; // 回退到上一个 loader
        iterateNormal(result);
      } else {
        // 无返回值 → 继续下一个 pitch
        loaderIndex++;
        iteratePitch();
      }
    }

    // ── 读取源文件 ────────────────────────────────────────────────────

    function processResource() {
      logs.push(`  读取源文件: ${resource}`);
      const source = readFile(resource);
      // 回到最后一个 loader，开始 Normal 阶段
      currentPhase = "normal";
      loaderIndex = loaderContexts.length - 1;
      iterateNormal(source);
    }

    // ── Normal 阶段（从右到左）────────────────────────────────────────

    function iterateNormal(content) {
      if (loaderIndex < 0) {
        // 所有 normal 执行完毕
        logs.push(`  最终结果: ${JSON.stringify(content).slice(0, 80)}...`);
        callback(null, content, logs);
        return;
      }

      const ctx = loaderContexts[loaderIndex];

      if (!ctx.normal) {
        loaderIndex--;
        iterateNormal(content);
        return;
      }

      logs.push(`  Normal ← ${ctx.name}()`);

      const thisArg = createLoaderContext(ctx);

      const result = ctx.normal.call(thisArg, content);

      if (thisArg._isAsync) {
        // 异步 normal：等 callback
        return;
      }

      loaderIndex--;
      iterateNormal(result);
    }

    // ── 构造 loaderContext（loader 中的 this）──────────────────────────
    //
    // webpack 的 loader 通过 this 访问各种工具方法：
    //   this.async()     → 让当前 loader 变为异步
    //   this.data        → pitch 和 normal 之间共享的数据
    //   this.resource    → 当前处理的文件路径
    //   this.addDependency() → 添加额外的文件依赖（watch 用）

    function createLoaderContext(ctx) {
      const thisArg = {
        data: ctx.data,
        resource,
        _isAsync: false,
        async() {
          thisArg._isAsync = true;
          const phase = currentPhase; // 捕获调用时的阶段
          return (err, result) => {
            if (err) {
              callback(err);
              return;
            }
            if (phase === "pitch") {
              handlePitchResult(result);
            } else {
              loaderIndex--;
              iterateNormal(result);
            }
          };
        },
      };
      return thisArg;
    }

    // 启动 Pitch 阶段
    iteratePitch();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 示例 Loader 定义
// ═══════════════════════════════════════════════════════════════════════════

// ── sass-loader（简化版）────────────────────────────────────────────────
// 将 SCSS 转为 CSS（这里用字符串替换模拟）
const sassLoader = {
  name: "sass-loader",
  normal(source) {
    // 模拟 SCSS → CSS 编译
    return source
      .replace(/\$primary:\s*(.+);/, "") // 移除变量声明
      .replace(/\$primary/g, "#4a90d9") // 替换变量引用为实际值
      .replace(/\.container\s*\{([^}]*)\{([^}]*)\}/, ".container $1\n.container button {$2}"); // 展开嵌套
  },
};

// ── css-loader（简化版）─────────────────────────────────────────────────
// 将 CSS 转为 JS 模块（导出 CSS 字符串）
const cssLoader = {
  name: "css-loader",
  normal(source) {
    // css-loader 的核心：将 CSS 字符串包装成 JS 模块
    const escaped = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `module.exports = "${escaped}";`;
  },
};

// ── style-loader（简化版，使用 pitch 熔断）──────────────────────────────
//
// style-loader 的巧妙之处：它的 normal 函数几乎不做事，核心逻辑在 pitch 中。
//
// 为什么？因为 style-loader 需要生成一段 JS 代码，这段代码：
//   1. require css-loader 的处理结果
//   2. 将 CSS 字符串注入到 <style> 标签中
//
// 如果在 normal 阶段做这件事，style-loader 拿到的输入是 css-loader 的输出（JS 模块字符串），
// 很难再 "require" 它。但在 pitch 阶段，可以用 remainingRequest 构造 inline require，
// 让 webpack 帮你执行 css-loader + sass-loader 并获取结果。
const styleLoader = {
  name: "style-loader",
  pitch(remainingRequest) {
    // this.data 可以传递信息给 normal 阶段（如果不熔断的话）
    this.data.pitched = true;

    // 返回一段 JS 代码 → 触发 Pitch 熔断
    // 这段代码在 bundle 中执行时会：
    //   1. require 剩余的 loader 链来获取 CSS 内容
    //   2. 创建 <style> 标签注入 CSS
    return `
// style-loader 生成的代码
var css = require("${remainingRequest}");
var style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
module.exports = css;
`;
  },
  // normal 函数作为后备（pitch 熔断时不会执行到这里）
  normal(source) {
    return source;
  },
};

// ── babel-loader（简化版，演示 async loader）─────────────────────────────
//
// babel-loader 在真实场景中是异步的，因为 Babel 的 transform 是异步操作。
// 通过 this.async() 获取 callback，异步完成后调用。
const babelLoader = {
  name: "babel-loader",
  normal(source) {
    // 调用 this.async() 标记为异步 loader
    const callback = this.async();

    // 模拟异步的 Babel 编译
    setTimeout(() => {
      const transformed = source
        .replace(/const /g, "var ") // 模拟 ES6 → ES5
        .replace(/let /g, "var ")
        .replace(/=>/g, "function"); // 箭头函数转换（极度简化）
      callback(null, transformed);
    }, 50);

    // 不需要 return，因为已经是异步模式
  },
};

// ── comment-loader（简化版，演示 pitch data 传递）────────────────────────
const commentLoader = {
  name: "comment-loader",
  pitch() {
    // 在 pitch 阶段记录时间戳，normal 阶段使用
    this.data.timestamp = Date.now();
    // 不返回值 → 不熔断，继续后续 pitch
  },
  normal(source) {
    // 通过 this.data 获取 pitch 阶段存储的数据
    return source + `\n// Processed at ${this.data.timestamp}`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 模拟文件系统
// ═══════════════════════════════════════════════════════════════════════════

const mockFiles = {
  "app.scss": `
$primary: #4a90d9;
.container {
  color: $primary;
  button { background: $primary; }
}`,

  "index.js": `
const greeting = (name) => {
  return 'Hello, ' + name;
};
let result = greeting('World');
console.log(result);
`,
};

function readFile(path) {
  return mockFiles[path] || "";
}

// ═══════════════════════════════════════════════════════════════════════════
// 演示
// ═══════════════════════════════════════════════════════════════════════════

function runDemo(title, config) {
  return new Promise((resolve) => {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${"─".repeat(60)}\n`);
    console.log(`  文件: ${config.resource}`);
    console.log(`  Loader 链: ${config.loaders.map((l) => l.name).join(" → ")}\n`);

    LoaderRunner.run({
      loaders: config.loaders,
      resource: config.resource,
      readFile,
      callback: (err, result, logs) => {
        if (err) {
          console.log("  错误:", err);
          resolve();
          return;
        }
        logs.forEach((log) => console.log(log));
        console.log("\n  完整输出:");
        result.split("\n").forEach((l) => console.log("    " + l));
        resolve();
      },
    });
  });
}

async function main() {
  console.log("=== Loader 完整生命周期演示 ===");

  // ── Demo 1：基本的 Normal 流程（无 pitch）───────────────────────────
  await runDemo("Demo 1: 基本 Normal 流程（sass → css → 无 pitch 熔断）", {
    resource: "app.scss",
    loaders: [cssLoader, sassLoader],
  });

  // ── Demo 2：Pitch 熔断（style-loader 的工作原理）──────────────────
  await runDemo("Demo 2: Pitch 熔断（style-loader.pitch 返回值，跳过后续 loader）", {
    resource: "app.scss",
    loaders: [styleLoader, cssLoader, sassLoader],
  });

  // ── Demo 3：Async Loader（babel-loader）─────────────────────────────
  await runDemo("Demo 3: Async Loader（babel-loader 通过 this.async() 异步处理）", {
    resource: "index.js",
    loaders: [babelLoader],
  });

  // ── Demo 4：Pitch Data 传递 ─────────────────────────────────────────
  await runDemo("Demo 4: Pitch 与 Normal 之间通过 this.data 传递数据", {
    resource: "index.js",
    loaders: [commentLoader],
  });

  // ── Demo 5：完整链路（comment + babel，混合同步异步）──────────────────
  await runDemo("Demo 5: 混合链路（comment-loader + babel-loader）", {
    resource: "index.js",
    loaders: [commentLoader, babelLoader],
  });

  // ── 总结 ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("  总结");
  console.log(`${"═".repeat(60)}\n`);
  console.log("  Loader 执行流程：");
  console.log("    Pitch 阶段（左→右）→ 读文件 → Normal 阶段（右→左）\n");
  console.log("  Pitch 熔断：");
  console.log("    pitch 返回值 → 跳过后续 pitch + 读文件 + 后续 normal");
  console.log("    返回值传给上一个 loader 的 normal（这就是 style-loader 的原理）\n");
  console.log("  Async Loader：");
  console.log("    this.async() 返回 callback → 异步完成后调用 callback(err, result)");
  console.log("    适用于 babel-loader、image-webpack-loader 等需要异步处理的场景\n");
  console.log("  this.data：");
  console.log("    pitch 和 normal 共享的数据对象");
  console.log("    pitch 阶段存入数据，normal 阶段读取使用");
}

main();
