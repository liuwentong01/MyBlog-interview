/**
 * Module Federation（模块联邦）运行时实现
 *
 * ═══════════════════════════════════════════════════════
 *  什么是 Module Federation？
 * ═══════════════════════════════════════════════════════
 *
 * webpack 5 引入的跨应用代码共享机制。
 * 多个独立构建的应用可以在运行时共享模块，无需 npm 发包。
 *
 *  传统方式：
 *    应用 A 导出 Button 组件
 *    → 发 npm 包 @shared/button
 *    → 应用 B npm install @shared/button
 *    → 应用 A 更新 → 重新发包 → 应用 B 重新安装 → 重新构建
 *
 *  Module Federation：
 *    应用 A 声明暴露 Button 组件
 *    → 应用 B 声明消费 A 的 Button
 *    → 运行时：B 通过 <script> 加载 A 的 remoteEntry.js → 直接使用 Button
 *    → A 更新 → B 下次加载时自动获取最新版本，无需重新构建
 *
 * ═══════════════════════════════════════════════════════
 *  核心概念
 * ═══════════════════════════════════════════════════════
 *
 *  Host（宿主）：消费远程模块的应用
 *  Remote（远程）：暴露模块的应用
 *  Container（容器）：每个构建的运行时入口，管理模块的暴露和消费
 *  Shared（共享）：多个应用共用的依赖（如 React），避免重复加载
 *
 *  webpack 配置：
 *
 *  // 应用 A（Remote）
 *  new ModuleFederationPlugin({
 *    name: 'appA',
 *    filename: 'remoteEntry.js',
 *    exposes: {
 *      './Button': './src/components/Button',
 *    },
 *    shared: ['react'],
 *  })
 *
 *  // 应用 B（Host）
 *  new ModuleFederationPlugin({
 *    name: 'appB',
 *    remotes: {
 *      appA: 'appA@http://localhost:3001/remoteEntry.js',
 *    },
 *    shared: ['react'],
 *  })
 *
 * ═══════════════════════════════════════════════════════
 *  运行时原理（与 async-loader-demo.js 的关系）
 * ═══════════════════════════════════════════════════════
 *
 * Module Federation 本质上是对 webpack 异步加载运行时的扩展：
 *
 *  普通 import()：
 *    require.e("chunkId")  → 加载本应用的 chunk
 *
 *  Module Federation：
 *    require.e("webpack/container/reference/appA")
 *      → 加载远程应用的 remoteEntry.js
 *      → remoteEntry.js 暴露一个 Container 对象
 *      → Container.get("./Button") 获取远程模块
 *
 *  所以 Module Federation 复用了 require.e / require.f 的策略模式，
 *  只是在 require.f 中新增了一个 "remotes" 策略。
 *
 * ═══════════════════════════════════════════════════════
 *  Container 协议
 * ═══════════════════════════════════════════════════════
 *
 *  每个参与 MF 的应用都会生成一个 Container，暴露两个方法：
 *
 *  container.init(shareScope)
 *    → 初始化共享作用域，告诉容器可以使用哪些共享依赖
 *    → shareScope 是一个嵌套对象：{ react: { '18.0.0': { get, loaded } } }
 *
 *  container.get(moduleName)
 *    → 返回 Promise<moduleFactory>，获取暴露的模块
 *    → moduleName 对应 exposes 配置中的 key，如 './Button'
 *
 * ═══════════════════════════════════════════════════════
 *  Shared 依赖的版本协商
 * ═══════════════════════════════════════════════════════
 *
 *  当多个应用都声明 shared: ['react'] 时：
 *
 *  1. 每个应用在自己的 container.init() 中向 shareScope 注册自己的 react 版本
 *  2. 实际使用时，从 shareScope 中选择最高的兼容版本
 *  3. 如果版本不兼容（如 A 用 React 17，B 用 React 18），各用各的
 *
 *  shareScope 结构：
 *  {
 *    default: {
 *      react: {
 *        '18.2.0': { get: () => Promise<reactModule>, from: 'appA', loaded: true },
 *        '18.3.0': { get: () => Promise<reactModule>, from: 'appB', loaded: false },
 *      },
 *      lodash: {
 *        '4.17.21': { get: () => ..., from: 'appA' }
 *      }
 *    }
 *  }
 *
 * 运行方式：node module-federation-demo.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// Container 实现
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 生成的 remoteEntry.js 中的核心逻辑。
// 每个参与 Module Federation 的应用都会生成这样一个 Container。

class Container {
  /**
   * @param {string} name      容器名称（如 'appA'）
   * @param {object} modules   暴露的模块 { './Button': moduleFactory }
   * @param {object} shared    共享依赖 { 'react': { version, factory } }
   */
  constructor(name, modules, shared) {
    this.name = name;
    this._modules = modules; // 暴露的模块工厂函数
    this._shared = shared; // 自身提供的共享依赖
    this._shareScope = null; // init 后设置
    this._initialized = false;
  }

  /**
   * 初始化共享作用域
   *
   * Host 调用 remote.init(shareScope) 时：
   *   1. 接收全局共享作用域
   *   2. 将自己的共享依赖注册到 shareScope 中
   *   3. 其他容器就能使用这些共享依赖
   *
   * @param {object} shareScope  全局共享作用域
   */
  init(shareScope) {
    if (this._initialized) return;
    this._initialized = true;
    this._shareScope = shareScope;

    // 将自己的共享依赖注册到 shareScope
    for (const [pkgName, info] of Object.entries(this._shared)) {
      if (!shareScope[pkgName]) {
        shareScope[pkgName] = {};
      }
      // 同一个包可能有多个版本（来自不同的容器）
      if (!shareScope[pkgName][info.version]) {
        shareScope[pkgName][info.version] = {
          get: info.factory, // 获取模块的工厂函数
          from: this.name,
          loaded: false,
        };
      }
    }
  }

  /**
   * 获取暴露的模块
   *
   * 对应 Host 中 import('appA/Button') 编译后的调用链：
   *   require.e("webpack/container/reference/appA")  // 加载 remoteEntry.js
   *     → appA.get("./Button")                       // 获取模块工厂
   *     → factory()                                  // 执行工厂获取模块
   *
   * @param {string} moduleName  模块名（如 './Button'）
   * @returns {Promise<Function>} 模块工厂函数
   */
  get(moduleName) {
    const factory = this._modules[moduleName];
    if (!factory) {
      return Promise.reject(
        new Error(`Module "${moduleName}" not found in container "${this.name}"`)
      );
    }
    return Promise.resolve(factory);
  }

  /**
   * 获取共享依赖（先从 shareScope 找高版本，找不到再用自己的）
   */
  getShared(pkgName) {
    if (!this._shareScope || !this._shareScope[pkgName]) {
      // shareScope 中没有 → 用自己的
      const own = this._shared[pkgName];
      return own ? own.factory() : null;
    }

    // 从 shareScope 中找最高版本
    const versions = this._shareScope[pkgName];
    const sortedVersions = Object.keys(versions).sort((a, b) => {
      // 简单的版本比较（真实实现用 semver）
      return b.localeCompare(a, undefined, { numeric: true });
    });

    const best = versions[sortedVersions[0]];
    best.loaded = true;
    return best.get();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 模拟两个独立构建的应用
// ═══════════════════════════════════════════════════════════════════════════

// ── 共享依赖：React（模拟）─────────────────────────────────────────────

function createReactModule(version) {
  return {
    version,
    createElement(type, props, ...children) {
      return { type, props: props || {}, children };
    },
    render(element) {
      return `<${element.type}>${element.children.join("")}</${element.type}>`;
    },
  };
}

// ── 应用 A（Remote）：暴露 Button 和 Header 组件 ───────────────────────

const appA = new Container(
  "appA",
  {
    // exposes: { './Button': ... }
    "./Button": () => {
      // 这个工厂函数在调用时执行，返回模块的 exports
      const module = { exports: {} };
      // 模拟组件代码
      module.exports = {
        Button({ text, onClick }) {
          return `[Button: ${text}]`;
        },
      };
      return module;
    },

    "./Header": () => {
      const module = { exports: {} };
      module.exports = {
        Header({ title }) {
          return `=== ${title} ===`;
        },
      };
      return module;
    },
  },
  {
    // shared: { react: { version, factory } }
    react: {
      version: "18.2.0",
      factory: () => createReactModule("18.2.0"),
    },
  }
);

// ── 应用 B（Remote）：暴露 Footer 组件 ─────────────────────────────────

const appB = new Container(
  "appB",
  {
    "./Footer": () => {
      const module = { exports: {} };
      module.exports = {
        Footer({ copyright }) {
          return `--- ${copyright} ---`;
        },
      };
      return module;
    },
  },
  {
    react: {
      version: "18.3.0", // 比 appA 更高的版本
      factory: () => createReactModule("18.3.0"),
    },
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// Host 应用：消费远程模块
// ═══════════════════════════════════════════════════════════════════════════
//
// 模拟 Host 应用的运行时。
// 在真实 webpack 中，以下逻辑由编译器自动生成。

class HostApp {
  constructor(name) {
    this.name = name;
    this.shareScope = {}; // 全局共享作用域
    this.remotes = {}; // 远程容器 { name: container }
  }

  /**
   * 注册远程应用
   * 在真实场景中，这一步对应加载 remoteEntry.js：
   *   1. <script src="http://appA.com/remoteEntry.js">
   *   2. 脚本执行后，window.appA 变成了一个 Container
   *   3. Host 调用 container.init(shareScope) 初始化
   */
  registerRemote(name, container) {
    this.remotes[name] = container;
    // 初始化远程容器，传入共享作用域
    container.init(this.shareScope);
  }

  /**
   * 消费远程模块
   * 对应 import('appA/Button') 编译后的代码
   */
  async importRemote(remoteName, moduleName) {
    const container = this.remotes[remoteName];
    if (!container) {
      throw new Error(`Remote "${remoteName}" not registered`);
    }
    const factory = await container.get(moduleName);
    const module = factory();
    return module.exports;
  }

  /**
   * 获取共享依赖（从 shareScope 中选最优版本）
   */
  getSharedModule(pkgName) {
    const versions = this.shareScope[pkgName];
    if (!versions) return null;

    const sortedVersions = Object.keys(versions).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );
    const best = versions[sortedVersions[0]];
    best.loaded = true;
    return { module: best.get(), version: sortedVersions[0], from: best.from };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 演示
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("=== Module Federation 模块联邦演示 ===\n");

  // ── 1. 创建 Host 应用 ─────────────────────────────────────────────
  console.log("【步骤 1】创建 Host 应用\n");
  const host = new HostApp("hostApp");
  console.log("  Host 应用已创建: hostApp");

  // ── 2. 注册远程应用（对应加载 remoteEntry.js）──────────────────────
  console.log("\n【步骤 2】注册远程应用（模拟加载 remoteEntry.js）\n");
  host.registerRemote("appA", appA);
  host.registerRemote("appB", appB);
  console.log("  已注册: appA（暴露 ./Button, ./Header）");
  console.log("  已注册: appB（暴露 ./Footer）");

  // ── 3. 查看共享作用域 ─────────────────────────────────────────────
  console.log("\n【步骤 3】共享作用域（Shared Scope）\n");
  console.log("  init() 后，各应用的共享依赖已合并到全局 shareScope：\n");
  for (const [pkg, versions] of Object.entries(host.shareScope)) {
    console.log(`  ${pkg}:`);
    for (const [ver, info] of Object.entries(versions)) {
      console.log(`    ${ver} (from ${info.from})`);
    }
  }

  // ── 4. 版本协商 ───────────────────────────────────────────────────
  console.log("\n【步骤 4】共享依赖版本协商\n");
  console.log("  appA 提供 react@18.2.0，appB 提供 react@18.3.0");
  const reactInfo = host.getSharedModule("react");
  console.log(`  选择最高版本: react@${reactInfo.version}（来自 ${reactInfo.from}）`);

  // ── 5. 消费远程模块 ───────────────────────────────────────────────
  console.log("\n【步骤 5】消费远程模块（import('appA/Button')）\n");

  const buttonModule = await host.importRemote("appA", "./Button");
  const headerModule = await host.importRemote("appA", "./Header");
  const footerModule = await host.importRemote("appB", "./Footer");

  console.log("  从 appA 获取 Button:", buttonModule.Button({ text: "Click me" }));
  console.log("  从 appA 获取 Header:", headerModule.Header({ title: "Module Federation" }));
  console.log("  从 appB 获取 Footer:", footerModule.Footer({ copyright: "2024 webpack" }));

  // ── 6. 模拟完整页面渲染 ───────────────────────────────────────────
  console.log("\n【步骤 6】模拟完整页面（组合多个远程组件）\n");
  const page = [
    headerModule.Header({ title: "My App" }),
    "Hello from host app!",
    buttonModule.Button({ text: "Remote Button" }),
    footerModule.Footer({ copyright: "Powered by Module Federation" }),
  ];
  console.log("  渲染结果：");
  page.forEach((line) => console.log("    " + line));

  // ── 7. 对应真实 webpack 的编译产物 ────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n【对应真实 webpack 的编译产物】\n");
  console.log("  Host 中 import('appA/Button') 编译为：\n");
  console.log("    // 1. 加载远程 entry（与 async chunk 加载复用同一套 JSONP 机制）");
  console.log('    require.e("webpack/container/reference/appA")');
  console.log("    // 2. 初始化远程容器");
  console.log("    .then(() => require.I(\"default\"))");
  console.log("    // 3. 从容器获取模块");
  console.log('    .then(() => appA.get("./Button"))');
  console.log("    // 4. 执行工厂函数获取 exports");
  console.log("    .then(factory => factory())");
  console.log("");
  console.log("  remoteEntry.js 的核心结构：\n");
  console.log("    var appA = {");
  console.log("      init(shareScope) { /* 注册共享依赖 */ },");
  console.log("      get(module) { /* 返回模块工厂 */ },");
  console.log("    };");

  // ── 总结 ─────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n  Module Federation 核心概念：\n");
  console.log("    Container    每个应用的运行时入口，暴露 init() + get()");
  console.log("    Host         消费远程模块的应用");
  console.log("    Remote       暴露模块的应用");
  console.log("    Share Scope  全局共享作用域，管理公共依赖的版本协商");
  console.log("");
  console.log("  与现有知识的关系：\n");
  console.log("    async-loader-demo.js 的 JSONP 加载 → 用于加载 remoteEntry.js");
  console.log("    code-splitting-demo.js 的 chunk 拆分 → remote 的 exposes 是独立 chunk");
  console.log("    tapable-demo.js 的 Hook 系统 → MF 插件通过 compiler hooks 注入运行时");
  console.log("");
  console.log("  典型应用场景：\n");
  console.log("    微前端     → 多个独立部署的应用共享组件");
  console.log("    大型后台   → 多团队独立开发，运行时组合");
  console.log("    组件库分发 → 不走 npm，直接运行时加载最新版本");
}

main();
