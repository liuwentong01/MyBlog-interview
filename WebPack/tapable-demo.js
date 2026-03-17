/**
 * Tapable 完整实现
 *
 * ═══════════════════════════════════════════════════════
 *  什么是 Tapable？
 * ═══════════════════════════════════════════════════════
 *
 * Tapable 是 webpack 的核心依赖，提供了一套发布-订阅机制。
 * webpack 内部有 200+ 个钩子（hooks），全部基于 tapable。
 * 所有 Plugin 通过 hook.tap() 注册回调，webpack 在合适的时机通过 hook.call() 触发。
 *
 * ═══════════════════════════════════════════════════════
 *  Hook 类型总览
 * ═══════════════════════════════════════════════════════
 *
 *  ┌──────────────────────┬───────────────────────────────────────────┐
 *  │ 类型                  │ 行为                                      │
 *  ├──────────────────────┼───────────────────────────────────────────┤
 *  │ SyncHook             │ 依次同步执行，忽略返回值                     │
 *  │ SyncBailHook         │ 依次执行，遇到非 undefined 返回值就中断       │
 *  │ SyncWaterfallHook    │ 链式传递：上一个的返回值作为下一个的第一个参数   │
 *  │ SyncLoopHook         │ 循环执行：某个回调返回非 undefined 就从头重来   │
 *  │ AsyncSeriesHook      │ 异步串行：等上一个完成再执行下一个             │
 *  │ AsyncSeriesBailHook  │ 异步串行 + Bail                            │
 *  │ AsyncParallelHook    │ 异步并行：所有回调同时启动，全部完成后结束       │
 *  └──────────────────────┴───────────────────────────────────────────┘
 *
 *  每种 Hook 支持三种注册方式：
 *    hook.tap('name', fn)         → 同步回调
 *    hook.tapAsync('name', fn)    → 异步回调（通过 callback 参数通知完成）
 *    hook.tapPromise('name', fn)  → 异步回调（返回 Promise）
 *@TODO: 这里我没太理解，以上注册方式，同步回调只能注册同步类型的Hook（比如SyncHook），异步回调只能注册异步类型的Hook（比如AsyncSeriesHook）  ，是这样吗
 * ═══════════════════════════════════════════════════════
 *  在 webpack 中的使用场景
 * ═══════════════════════════════════════════════════════
 *
 *  SyncHook        → compiler.hooks.run（通知性质，不关心返回值）
 *  SyncBailHook    → compiler.hooks.shouldEmit（任一插件返回 false 就不输出）
 *  SyncWaterfallHook → compilation.hooks.assetPath（链式处理文件路径模板）
 *  AsyncSeriesHook → compiler.hooks.emit（多个插件按顺序异步写文件）
 *  AsyncParallelHook → compiler.hooks.make（多个入口并行编译）
 *
 * 运行方式：node tapable-demo.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 基类：所有 Hook 共享的注册逻辑
// ═══════════════════════════════════════════════════════════════════════════

class Hook {
  /**
   * @param {string[]} argNames  call() 时传入的参数名列表（文档用途 + 校验）
   */
  constructor(argNames = []) {
    this._argNames = argNames;
    this._taps = []; // 存放所有注册的回调 { type: 'sync'|'async'|'promise', name, fn }
  }

  /**
   * 注册同步回调
   * @param {string}   name  插件名称（调试用）
   * @param {Function} fn    回调函数
   */
  tap(name, fn) {
    this._taps.push({ type: "sync", name, fn });
  }

  /**
   * 注册异步回调（callback 风格）
   * fn 的最后一个参数是 callback，调用 callback() 表示完成
   */
  tapAsync(name, fn) {
    this._taps.push({ type: "async", name, fn });
  }

  /**
   * 注册异步回调（Promise 风格）
   * fn 返回一个 Promise，resolve 表示完成
   */
  tapPromise(name, fn) {
    this._taps.push({ type: "promise", name, fn });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SyncHook：最基础的同步钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 依次执行所有回调，忽略返回值。
// webpack 场景：compiler.hooks.run、compiler.hooks.done

class SyncHook extends Hook {
  call(...args) {
    // TODO 这里的this会指父类的实例，还是子类的实例？
    for (const tap of this._taps) {
      tap.fn(...args);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SyncBailHook：同步熔断钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 依次执行，某个回调返回非 undefined 的值时立即中断，后续回调不执行。
// 返回值作为 call() 的返回值。
//
// webpack 场景：
//   compiler.hooks.shouldEmit → 任一插件返回 false 就不输出文件
//   resolverFactory.hooks.resolveOptions → 先匹配到的解析规则生效

class SyncBailHook extends Hook {
  call(...args) {
    for (const tap of this._taps) {
      const result = tap.fn(...args);
      // 非 undefined 就中断（注意：null、false、0 都算"有返回值"）
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SyncWaterfallHook：同步瀑布流钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 链式传递：每个回调的返回值作为下一个回调的第一个参数。
// call() 的返回值是最后一个回调的返回值。
//
// webpack 场景：
//   compilation.hooks.assetPath → 链式处理文件路径模板
//   例：'[name].[hash].js' → 插件A替换[name] → 插件B替换[hash]

class SyncWaterfallHook extends Hook {
  call(...args) {
    let current = args[0]; // 第一个参数是初始值
    const restArgs = args.slice(1);

    for (const tap of this._taps) {
      const result = tap.fn(current, ...restArgs);
      // 有返回值就传给下一个，没有就保持当前值（容错设计）
      if (result !== undefined) {
        current = result;
      }
    }
    return current;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SyncLoopHook：同步循环钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 循环执行所有回调，如果某个回调返回非 undefined，就从第一个回调重新开始。
// 直到所有回调都返回 undefined 才结束。
//
// webpack 场景较少，但体现了 tapable 的设计完整性。
// 典型用途：需要反复检查直到条件满足的场景。

class SyncLoopHook extends Hook {
  call(...args) {
    let looping = true;
    while (looping) {
      looping = false;
      for (const tap of this._taps) {
        const result = tap.fn(...args);
        if (result !== undefined) {
          // 某个回调还没准备好 → 从头再来
          looping = true;
          break;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AsyncSeriesHook：异步串行钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 依次执行异步回调，等一个完成后再执行下一个。
// 支持三种混用：tap（同步）、tapAsync（callback）、tapPromise（Promise）。
//
// webpack 场景：
//   compiler.hooks.emit → 多个插件按顺序异步写文件
//   compiler.hooks.afterEmit → 异步上传、通知等

class AsyncSeriesHook extends Hook {
  /**
   * 触发所有注册的异步回调（串行执行）
   * 返回 Promise，所有回调执行完后 resolve
   */
  callAsync(...argsAndCallback) {
    // 最后一个参数是完成回调（webpack 风格）
    const finalCallback = argsAndCallback.pop();
    const args = argsAndCallback;
    const taps = this._taps;
    let index = 0;

    const next = () => {
      if (index >= taps.length) {
        finalCallback();
        return;
      }

      const tap = taps[index++];

      if (tap.type === "sync") {
        // 同步回调：直接执行，然后下一个
        tap.fn(...args);
        next();
      } else if (tap.type === "async") {
        // callback 风格：fn(...args, callback)
        tap.fn(...args, () => next());
      } else if (tap.type === "promise") {
        // Promise 风格：等 resolve 后下一个
        tap.fn(...args).then(() => next());
      }
    };

    next();
  }

  /**
   * Promise 风格的触发
   */
  promise(...args) {
    return new Promise((resolve) => {
      this.callAsync(...args, resolve);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AsyncSeriesBailHook：异步串行熔断钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 与 AsyncSeriesHook 类似，但某个回调传递非 undefined 结果时中断。

class AsyncSeriesBailHook extends Hook {
  callAsync(...argsAndCallback) {
    const finalCallback = argsAndCallback.pop();
    const args = argsAndCallback;
    const taps = this._taps;
    let index = 0;

    const next = (result) => {
      if (result !== undefined) {
        finalCallback(result);
        return;
      }
      if (index >= taps.length) {
        finalCallback();
        return;
      }

      const tap = taps[index++];

      if (tap.type === "sync") {
        const r = tap.fn(...args);
        next(r);
      } else if (tap.type === "async") {
        tap.fn(...args, (r) => next(r));
      } else if (tap.type === "promise") {
        tap.fn(...args).then((r) => next(r));
      }
    };

    next(undefined);
  }

  promise(...args) {
    return new Promise((resolve) => {
      this.callAsync(...args, resolve);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AsyncParallelHook：异步并行钩子
// ═══════════════════════════════════════════════════════════════════════════
//
// 所有回调同时启动，全部完成后才触发最终回调。
// 等价于 Promise.all。
//
// webpack 场景：
//   compiler.hooks.make → 多个入口并行编译

class AsyncParallelHook extends Hook {
  callAsync(...argsAndCallback) {
    const finalCallback = argsAndCallback.pop();
    const args = argsAndCallback;
    const taps = this._taps;

    if (taps.length === 0) {
      finalCallback();
      return;
    }

    let remaining = taps.length;
    const done = () => {
      remaining--;
      if (remaining === 0) finalCallback();
    };

    for (const tap of taps) {
      if (tap.type === "sync") {
        tap.fn(...args);
        done();
      } else if (tap.type === "async") {
        tap.fn(...args, done);
      } else if (tap.type === "promise") {
        tap.fn(...args).then(done);
      }
    }
  }

  promise(...args) {
    return new Promise((resolve) => {
      this.callAsync(...args, resolve);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 演示
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("=== Tapable 完整实现演示 ===\n");

  // ── 1. SyncHook ──────────────────────────────────────────────────────
  console.log("【SyncHook】依次执行，忽略返回值\n");
  {
    const hook = new SyncHook(["name"]);
    hook.tap("PluginA", (name) => console.log(`  PluginA: Hello ${name}`));
    hook.tap("PluginB", (name) => console.log(`  PluginB: Hi ${name}`));
    hook.call("webpack");
    // 输出：PluginA: Hello webpack → PluginB: Hi webpack
  }

  // ── 2. SyncBailHook ──────────────────────────────────────────────────
  console.log("\n【SyncBailHook】遇到返回值就中断\n");
  console.log("  场景：compiler.hooks.shouldEmit，任一插件返回 false 就不输出\n");
  {
    const hook = new SyncBailHook(["compilation"]);
    hook.tap("CheckSize", () => {
      console.log("  CheckSize: 文件大小正常");
      return undefined; // 不中断
    });
    hook.tap("CheckError", () => {
      console.log("  CheckError: 发现编译错误，中断！");
      return false; // 中断！后续不执行
    });
    hook.tap("NeverReached", () => {
      console.log("  NeverReached: 这行不会打印");
    });
    const result = hook.call({});
    console.log(`  最终结果: ${result}`);
  }

  // ── 3. SyncWaterfallHook ─────────────────────────────────────────────
  console.log("\n【SyncWaterfallHook】链式传递返回值\n");
  console.log("  场景：compilation.hooks.assetPath，链式处理文件名模板\n");
  {
    const hook = new SyncWaterfallHook(["filename"]);
    hook.tap("ReplaceName", (filename) => {
      const result = filename.replace("[name]", "main");
      console.log(`  ReplaceName: "${filename}" → "${result}"`);
      return result;
    });
    hook.tap("ReplaceHash", (filename) => {
      const result = filename.replace("[hash]", "a1b2c3");
      console.log(`  ReplaceHash: "${filename}" → "${result}"`);
      return result;
    });
    hook.tap("ReplaceExt", (filename) => {
      const result = filename.replace("[ext]", "js");
      console.log(`  ReplaceExt:  "${filename}" → "${result}"`);
      return result;
    });
    const final = hook.call("[name].[hash].[ext]");
    console.log(`  最终文件名: "${final}"`);
  }

  // ── 4. SyncLoopHook ──────────────────────────────────────────────────
  console.log("\n【SyncLoopHook】某个回调返回非 undefined 就从头重来\n");
  {
    const hook = new SyncLoopHook([]);
    let countA = 0;
    let countB = 0;
    hook.tap("LooperA", () => {
      if (countA < 2) {
        countA++;
        console.log(`  LooperA: 第 ${countA} 次，还没准备好 → 重来`);
        return true; // 非 undefined → 从头重来
      }
      console.log(`  LooperA: 准备好了`);
    });
    hook.tap("LooperB", () => {
      if (countB < 1) {
        countB++;
        console.log(`  LooperB: 第 ${countB} 次，还没准备好 → 重来`);
        return true;
      }
      console.log(`  LooperB: 准备好了`);
    });
    hook.call();
    console.log(`  循环结束（A 执行了 ${countA + 1} 次，B 执行了 ${countB + 1} 次）`);
  }

  // ── 5. AsyncSeriesHook ───────────────────────────────────────────────
  console.log("\n【AsyncSeriesHook】异步串行，等上一个完成再执行下一个\n");
  console.log("  场景：compiler.hooks.emit，多个插件按顺序异步写文件\n");
  {
    const hook = new AsyncSeriesHook(["assets"]);

    // 三种注册方式混用
    hook.tap("SyncPlugin", (assets) => {
      console.log("  SyncPlugin: 同步处理 assets");
    });
    hook.tapAsync("WriteFile", (assets, callback) => {
      console.log("  WriteFile: 开始异步写文件...");
      setTimeout(() => {
        console.log("  WriteFile: 写文件完成");
        callback();
      }, 100);
    });
    hook.tapPromise("Upload", (assets) => {
      console.log("  Upload: 开始上传...");
      return new Promise((resolve) => {
        setTimeout(() => {
          console.log("  Upload: 上传完成");
          resolve();
        }, 100);
      });
    });

    await hook.promise({});
    console.log("  全部完成");
  }

  // ── 6. AsyncParallelHook ─────────────────────────────────────────────
  console.log("\n【AsyncParallelHook】异步并行，所有回调同时启动\n");
  console.log("  场景：compiler.hooks.make，多个入口并行编译\n");
  {
    const hook = new AsyncParallelHook(["compilation"]);

    hook.tapPromise("EntryA", () => {
      console.log("  EntryA: 开始编译...");
      return new Promise((resolve) => {
        setTimeout(() => {
          console.log("  EntryA: 编译完成（耗时 150ms）");
          resolve();
        }, 150);
      });
    });
    hook.tapPromise("EntryB", () => {
      console.log("  EntryB: 开始编译...");
      return new Promise((resolve) => {
        setTimeout(() => {
          console.log("  EntryB: 编译完成（耗时 80ms）");
          resolve();
        }, 80);
      });
    });
    hook.tapAsync("EntryC", (_, callback) => {
      console.log("  EntryC: 开始编译...");
      setTimeout(() => {
        console.log("  EntryC: 编译完成（耗时 120ms）");
        callback();
      }, 120);
    });

    await hook.promise({});
    console.log("  全部入口编译完成");
  }

  // ── 7. 模拟 webpack Compiler 的 hooks ────────────────────────────────
  console.log("\n【模拟 webpack Compiler】用各种 Hook 组合编排编译流程\n");
  {
    class MiniCompiler {
      constructor() {
        this.hooks = {
          shouldEmit: new SyncBailHook(["compilation"]),
          run: new SyncHook([]),
          emit: new AsyncSeriesHook(["assets"]),
          assetPath: new SyncWaterfallHook(["template", "data"]),
          done: new SyncHook(["stats"]),
        };
      }

      async run() {
        console.log("  compiler.run() 开始");
        this.hooks.run.call();

        // 检查是否应该输出
        const shouldEmit = this.hooks.shouldEmit.call({});
        if (shouldEmit === false) {
          console.log("  shouldEmit 返回 false，跳过输出");
          return;
        }

        // 处理文件名
        const filename = this.hooks.assetPath.call("[name].[hash].js", {
          name: "main",
          hash: "abc123",
        });
        console.log(`  最终文件名: ${filename}`);

        // 异步 emit
        await this.hooks.emit.promise({ [filename]: "bundle content..." });

        this.hooks.done.call({ time: 42 });
      }
    }

    const compiler = new MiniCompiler();

    // 注册插件（与 webpack 插件模式一致）
    compiler.hooks.run.tap("LogPlugin", () => console.log("  [LogPlugin] 编译开始"));
    compiler.hooks.shouldEmit.tap("AlwaysEmit", () => undefined); // 不中断
    compiler.hooks.assetPath.tap("NameReplace", (tpl) => tpl.replace("[name]", "main"));
    compiler.hooks.assetPath.tap("HashReplace", (tpl) => tpl.replace("[hash]", "abc123"));
    compiler.hooks.emit.tapPromise("WritePlugin", (assets) => {
      return new Promise((resolve) => {
        console.log("  [WritePlugin] 异步写文件...");
        setTimeout(() => {
          console.log("  [WritePlugin] 写文件完成");
          resolve();
        }, 50);
      });
    });
    compiler.hooks.done.tap("DonePlugin", (stats) =>
      console.log(`  [DonePlugin] 编译完成，耗时 ${stats.time}ms`)
    );

    await compiler.run();
  }

  // ── 总结 ─────────────────────────────────────────────────────────────
  console.log("\n=== 总结 ===\n");
  console.log("  Hook 类型         执行方式      核心特点");
  console.log("  ─────────────────────────────────────────────────");
  console.log("  SyncHook          同步串行      忽略返回值");
  console.log("  SyncBailHook      同步串行      非 undefined 中断");
  console.log("  SyncWaterfallHook 同步串行      返回值传给下一个");
  console.log("  SyncLoopHook      同步循环      非 undefined 从头重来");
  console.log("  AsyncSeriesHook   异步串行      等上一个完成再下一个");
  console.log("  AsyncSeriesBailHook 异步串行    callback 传值中断");
  console.log("  AsyncParallelHook 异步并行      全部完成后回调");
  console.log("");
  console.log("  webpack 的 200+ 钩子全部基于这些类型，");
  console.log("  理解了这 7 种 Hook 就理解了 webpack 插件协作的全部机制。");
}

main();
