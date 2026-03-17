/**
 * ═══════════════════════════════════════════════════════
 *  @TODO 问题与解答
 * ═══════════════════════════════════════════════════════
 *
 * Q1: (第32行) tap/tapAsync/tapPromise 三种注册方式，同步回调只能注册同步类型的 Hook（如 SyncHook），
 *     异步回调只能注册异步类型的 Hook（如 AsyncSeriesHook），是这样吗？
 *
 * A1: 不完全是。规则如下：
 *     - Sync 类型的 Hook（SyncHook、SyncBailHook 等）：只能用 tap() 注册同步回调。
 *       如果用 tapAsync/tapPromise 注册，在真正的 tapable 库中会直接抛错。
 *       因为 Sync Hook 的 call() 是同步执行的，无法处理异步逻辑。
 *     - Async 类型的 Hook（AsyncSeriesHook、AsyncParallelHook 等）：三种方式都可以用！
 *       可以用 tap() 注册同步回调，也可以用 tapAsync() 或 tapPromise() 注册异步回调。
 *       从本文件的 AsyncSeriesHook.callAsync() 实现中就能看到，它对 sync/async/promise
 *       三种 type 分别做了处理。这也是 webpack 插件开发中常见的混用模式。
 *     总结：Sync Hook 只能 tap()；Async Hook 可以 tap() + tapAsync() + tapPromise() 混用。
 *
 * ───────────────────────────────────────────────────────
 *
 * Q2: (第55行) _argNames 的作用是什么？整个文件没有用到。
 *
 * A2: _argNames 在本文件的简化实现中确实没有被使用，但在真正的 tapable 库中有两个作用：
 *     1. 代码生成优化：tapable 内部会根据 argNames 动态生成（new Function）调用代码，
 *        例如 new SyncHook(['name', 'age']) 会生成 function(name, age){...} 的形式，
 *        避免使用 ...args 展开运算符，从而获得更好的 V8 执行性能。
 *     2. 参数数量校验：call() 时传入的参数个数会被限制为 argNames.length，
 *        多余的参数会被截断。例如 new SyncHook(['name']) 后调用 hook.call('a','b')，
 *        回调只会收到 'a'，'b' 会被丢弃。这保证了 Hook 的"契约"——声明几个参数就传几个。
 *     3. 文档/自描述：argNames 让开发者在定义 Hook 时就明确"这个钩子需要哪些参数"，
 *        相当于一种轻量的类型声明，提高了可读性和可维护性。
 *
 * ───────────────────────────────────────────────────────
 *
 * Q3: (第95行) SyncHook.call() 中的 this 会指向父类的实例还是子类的实例？
 *
 * A3: 指向子类（SyncHook）的实例。
 *     JavaScript 中 this 始终指向调用方法的那个对象，与方法定义在哪个类中无关。
 *     当你执行 const hook = new SyncHook(['name']); hook.call('webpack') 时：
 *     - new SyncHook() 创建了一个 SyncHook 实例
 *     - 由于 SyncHook 没有定义自己的 constructor，会调用父类 Hook 的 constructor
 *     - 但 this 始终是这个 SyncHook 实例（不存在"父类实例"这种东西）
 *     - hook.call() 中 this._taps 访问的就是这个实例上的 _taps 属性
 *     本质上，class 继承中只有一个实例对象。"父类构造函数"只是在子类实例上初始化属性，
 *     并不会创建一个独立的"父类实例"。所以 this 永远指向 new 出来的那个子类实例。
 *
 * ═══════════════════════════════════════════════════════
 */

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
}

main();
