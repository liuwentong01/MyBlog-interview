/**
 * Persistent Cache（持久化缓存）实现
 *
 * ═══════════════════════════════════════════════════════
 *  为什么需要持久化缓存？
 * ═══════════════════════════════════════════════════════
 *
 * webpack 4 只有内存缓存——关闭进程后缓存消失，下次启动从零编译。
 * 大型项目首次编译可能 30-60s，每次重启都要等。
 *
 * webpack 5 引入 filesystem cache：
 *   cache: { type: 'filesystem' }
 *   编译结果持久化到磁盘 → 二次启动只需 2-3s
 *
 * ═══════════════════════════════════════════════════════
 *  核心问题：如何判断缓存是否有效？
 * ═══════════════════════════════════════════════════════
 *
 * 不能简单地用"文件没变就用缓存"，因为很多因素会影响编译结果：
 *
 *   1. 源文件内容变了        → 缓存失效
 *   2. loader 配置变了       → 同样的文件但转换规则变了 → 缓存失效
 *   3. loader 版本升级       → 缓存失效
 *   4. webpack 配置变了      → 缓存失效
 *   5. 依赖的模块内容变了     → 缓存失效
 *   6. 环境变量变了(NODE_ENV) → 缓存失效
 *
 * webpack 5 的做法：为每个模块计算 ETag（基于上述所有因素的综合哈希）
 *
 *  ETag = hash(
 *    文件内容 hash +
 *    loader 配置序列化 +
 *    webpack 版本 +
 *    buildDependencies 的文件 hash +
 *    ...
 *  )
 *
 *  下次编译时：
 *    1. 计算新的 ETag
 *    2. 对比缓存中的 ETag
 *    3. 相同 → 跳过编译，直接用缓存
 *    4. 不同 → 重新编译，更新缓存
 *
 * ═══════════════════════════════════════════════════════
 *  webpack 5 的缓存结构
 * ═══════════════════════════════════════════════════════
 *
 *  node_modules/.cache/webpack/
 *  ├── default-development/    ← 按 name + mode 分目录
 *  │   ├── 0.pack             ← 序列化的缓存包（包含多个模块的编译结果）
 *  │   ├── index.pack         ← 缓存索引
 *  │   └── ...
 *  └── default-production/
 *      └── ...
 *
 *  每个 .pack 文件中存储：
 *    - 模块的 AST / 转换后的代码
 *    - 模块的 dependencies 列表
 *    - 模块的 hash / ETag
 *    - chunk 的组成信息
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现的简化版
 * ═══════════════════════════════════════════════════════
 *
 *  - 基于文件系统的 JSON 缓存（真实 webpack 用二进制序列化）
 *  - ETag = hash(文件内容 + loader 配置 + 依赖内容)
 *  - 完整的缓存命中/失效判断逻辑
 *  - 模拟多次编译来演示缓存效果
 *
 * 运行方式：cd WebPack/mini-webpack && npm install && cd .. && node persistent-cache-demo.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// 复用 mini-webpack 的 babel 依赖
const parser = require("./mini-webpack/node_modules/@babel/parser");
const traverse = require("./mini-webpack/node_modules/@babel/traverse").default;
const generator = require("./mini-webpack/node_modules/@babel/generator").default;
const types = require("./mini-webpack/node_modules/@babel/types");

// ─── 缓存目录 ────────────────────────────────────────────────────────────────

const CACHE_DIR = path.resolve(__dirname, "persistent-cache-dist", ".cache");

// ═══════════════════════════════════════════════════════════════════════════
// PersistentCache：磁盘缓存管理器
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 5 的 PackFileCacheStrategy：
//   - 读取和写入磁盘缓存
//   - 基于 ETag 判断缓存有效性
//   - 管理缓存的生命周期

class PersistentCache {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.cacheFile = path.join(cacheDir, "cache.json");
    this.data = this._load();
    this.stats = { hit: 0, miss: 0 };
  }

  _load() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        return JSON.parse(fs.readFileSync(this.cacheFile, "utf8"));
      }
    } catch (e) {
      // 缓存文件损坏，忽略
    }
    return {};
  }

  /**
   * 查询缓存
   * @param {string} key    缓存键（模块 ID）
   * @param {string} etag   当前计算的 ETag
   * @returns {object|null} 缓存命中返回模块数据，否则返回 null
   */
  get(key, etag) {
    const entry = this.data[key];
    if (entry && entry.etag === etag) {
      this.stats.hit++;
      return entry.value;
    }
    this.stats.miss++;
    return null;
  }

  /**
   * 写入缓存
   */
  set(key, etag, value) {
    this.data[key] = { etag, value, timestamp: Date.now() };
  }

  /**
   * 持久化到磁盘
   */
  save() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.data, null, 2));
  }

  /**
   * 清空缓存
   */
  clear() {
    this.data = {};
    if (fs.existsSync(this.cacheFile)) {
      fs.unlinkSync(this.cacheFile);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ETag 计算
// ═══════════════════════════════════════════════════════════════════════════
//
// webpack 5 的 ETag 计算非常复杂，综合了：
//   - 文件内容 hash
//   - loader 配置（哪些 loader、什么参数）
//   - webpack 版本
//   - Node.js 版本
//   - buildDependencies（webpack.config.js 等配置文件的内容）
//   - resolve 配置
//
// 这里简化为：hash(文件内容 + loader 配置 + 依赖关系)

function computeETag(source, loaderConfig, dependencies) {
  const hash = crypto.createHash("md5");
  hash.update(source);
  hash.update(JSON.stringify(loaderConfig));
  // 依赖文件的内容也影响 ETag
  // 例：A import B，B 内容变了 → A 的缓存也应该失效
  // （这里简化为只考虑直接依赖的文件内容）
  if (dependencies) {
    hash.update(JSON.stringify(dependencies));
  }
  return hash.digest("hex").slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// 带缓存的编译器
// ═══════════════════════════════════════════════════════════════════════════
//
// 在 mini-webpack 的 buildModule 基础上增加缓存层：
//   1. 读取文件 → 计算 ETag
//   2. 查缓存 → 命中则跳过编译
//   3. 未命中 → 正常编译 → 写入缓存

class CachedCompiler {
  constructor(files, config) {
    this.files = files; // 模拟文件系统 { path: content }
    this.config = config;
    this.cache = new PersistentCache(CACHE_DIR);
    this.modules = [];
  }

  buildModule(moduleId) {
    const existMod = this.modules.find((m) => m.id === moduleId);
    if (existMod) return existMod;

    const source = this.files[moduleId];
    if (!source) throw new Error("模块未找到: " + moduleId);

    // ── 计算 ETag ──────────────────────────────────────────────────────
    const etag = computeETag(source, this.config.loaders || [], null);

    // ── 查缓存 ────────────────────────────────────────────────────────
    const cached = this.cache.get(moduleId, etag);
    if (cached) {
      console.log(`  [CACHE HIT]  ${moduleId} (etag: ${etag.slice(0, 8)})`);
      const mod = { ...cached, fromCache: true };
      this.modules.push(mod);
      // 递归处理依赖（依赖可能缓存失效了）
      cached.dependencies.forEach((dep) => this.buildModule(dep.depModuleId));
      return mod;
    }

    console.log(`  [CACHE MISS] ${moduleId} (etag: ${etag.slice(0, 8)}) → 重新编译`);

    // ── 编译（与 mini-webpack 逻辑一致）────────────────────────────────
    const startTime = Date.now();
    const ast = parser.parse(source, { sourceType: "module" });
    const dependencies = [];

    traverse(ast, {
      CallExpression({ node }) {
        if (node.callee.name === "require" && node.callee.type === "Identifier") {
          const depName = node.arguments[0]?.value;
          if (typeof depName !== "string") return;
          let depId = depName.replace("./", "");
          if (!depId.endsWith(".js")) depId += ".js";
          node.arguments = [types.stringLiteral(depId)];
          dependencies.push({ depModuleId: depId });
        }
      },
    });

    const { code } = generator(ast);

    // 模拟编译耗时（真实项目中 Babel 转换、TypeScript 编译等是耗时大户）
    const elapsed = Date.now() - startTime;

    const mod = {
      id: moduleId,
      _source: code,
      dependencies,
      fromCache: false,
      compileTime: elapsed,
    };

    this.modules.push(mod);

    // ── 写入缓存 ──────────────────────────────────────────────────────
    this.cache.set(moduleId, etag, {
      id: moduleId,
      _source: code,
      dependencies,
    });

    // 递归编译依赖
    dependencies.forEach((dep) => this.buildModule(dep.depModuleId));

    return mod;
  }

  run(entryId) {
    const startTime = Date.now();
    this.modules = [];
    this.cache.stats = { hit: 0, miss: 0 };

    this.buildModule(entryId);

    const elapsed = Date.now() - startTime;

    // 持久化缓存到磁盘
    this.cache.save();

    return {
      modules: this.modules,
      elapsed,
      cacheStats: { ...this.cache.stats },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 演示
// ═══════════════════════════════════════════════════════════════════════════

// 模拟文件系统（可修改来触发缓存失效）
const files = {
  "index.js": `const greet = require('./greeting');
const utils = require('./utils');
console.log(greet('World'));
console.log(utils.format('webpack'));`,

  "greeting.js": `const helper = require('./helper');
module.exports = function(name) { return helper.prefix() + 'Hello, ' + name + '!'; };`,

  "helper.js": `module.exports = { prefix: function() { return '[v1] '; } };`,

  "utils.js": `module.exports = { format: function(s) { return '<<' + s + '>>'; } };`,
};

function printResult(label, result) {
  console.log(`\n  结果:`);
  console.log(`    模块数: ${result.modules.length}`);
  console.log(`    缓存命中: ${result.cacheStats.hit}`);
  console.log(`    缓存未中: ${result.cacheStats.miss}`);
  console.log(`    耗时: ${result.elapsed}ms`);
  console.log(`    模块详情:`);
  result.modules.forEach((m) => {
    const status = m.fromCache ? "from cache" : `compiled (${m.compileTime}ms)`;
    console.log(`      ${m.id} → ${status}`);
  });
}

function main() {
  console.log("=== Persistent Cache 持久化缓存演示 ===\n");

  // 清除旧缓存
  const cache = new PersistentCache(CACHE_DIR);
  cache.clear();

  // ── 第 1 次编译：缓存为空，所有模块都要编译 ─────────────────────────
  console.log("【第 1 次编译】缓存为空\n");
  {
    const compiler = new CachedCompiler(files, {});
    const result = compiler.run("index.js");
    printResult("第 1 次", result);
  }

  // ── 第 2 次编译：文件没变，全部命中缓存 ──────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n【第 2 次编译】文件未修改，期望全部命中缓存\n");
  {
    const compiler = new CachedCompiler(files, {});
    const result = compiler.run("index.js");
    printResult("第 2 次", result);
  }

  // ── 第 3 次编译：修改了 helper.js ────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n【第 3 次编译】修改 helper.js（[v1] → [v2]）\n");
  {
    const modifiedFiles = {
      ...files,
      "helper.js": `module.exports = { prefix: function() { return '[v2] '; } };`,
    };
    const compiler = new CachedCompiler(modifiedFiles, {});
    const result = compiler.run("index.js");
    printResult("第 3 次", result);

    console.log("\n  分析:");
    console.log("    helper.js 内容变了 → ETag 变了 → 缓存失效 → 重新编译");
    console.log("    index.js / greeting.js / utils.js 内容没变 → 命中缓存");
    console.log("    （注意：真实 webpack 中 greeting.js 依赖 helper.js，");
    console.log("     如果用更精确的 ETag 计算，greeting.js 也应该失效。");
    console.log("     这里简化为只基于自身文件内容计算 ETag。）");
  }

  // ── 第 4 次编译：修改 loader 配置 ────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n【第 4 次编译】修改 loader 配置（新增 babel-loader）\n");
  {
    const compiler = new CachedCompiler(files, {
      loaders: [{ test: /\.js$/, use: ["babel-loader"] }],
    });
    const result = compiler.run("index.js");
    printResult("第 4 次", result);

    console.log("\n  分析:");
    console.log("    loader 配置变了 → 所有模块的 ETag 都变了 → 全部重新编译");
    console.log("    即使文件内容没变，转换规则变了，编译结果也不同");
  }

  // ── 查看磁盘缓存内容 ────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n【磁盘缓存内容】\n");
  {
    const cacheFile = path.join(CACHE_DIR, "cache.json");
    if (fs.existsSync(cacheFile)) {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      for (const [key, entry] of Object.entries(cacheData)) {
        console.log(`  ${key}:`);
        console.log(`    etag: ${entry.etag}`);
        console.log(`    timestamp: ${new Date(entry.timestamp).toISOString()}`);
        console.log(`    dependencies: [${entry.value.dependencies.map((d) => d.depModuleId).join(", ")}]`);
        console.log(`    code: ${entry.value._source.slice(0, 60)}...`);
        console.log();
      }
      console.log(`  缓存文件: ${cacheFile}`);
      console.log(`  文件大小: ${fs.statSync(cacheFile).size} bytes`);
    }
  }

  // ── 总结 ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("\n  webpack 5 持久化缓存配置：");
  console.log("    cache: {");
  console.log("      type: 'filesystem',");
  console.log("      buildDependencies: {");
  console.log("        config: [__filename],  // 配置文件变了就清缓存");
  console.log("      }");
  console.log("    }\n");
  console.log("  缓存失效条件：");
  console.log("    - 源文件内容变化     → 对应模块缓存失效");
  console.log("    - loader 配置变化    → 所有模块缓存失效");
  console.log("    - webpack 版本升级   → 全部失效（version 字段）");
  console.log("    - buildDependencies  → webpack.config.js 变了全部失效");
  console.log("    - 手动删除 .cache 目录 → 全部失效\n");
  console.log("  真实 webpack 的额外优化：");
  console.log("    - 二进制序列化（比 JSON 快 10x）");
  console.log("    - 分包存储（.pack 文件），避免单文件过大");
  console.log("    - 惰性反序列化（用到哪个模块才解析）");
  console.log("    - 内存 + 磁盘两级缓存");
}

main();
