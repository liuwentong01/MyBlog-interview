/**
 * SplitChunksPlugin（分包策略）实现演示
 *
 * ═══════════════════════════════════════════════════════
 *  与 code-splitting-demo.js 的区别
 * ═══════════════════════════════════════════════════════
 *
 * code-splitting-demo.js = 手动分割（开发者写 import() 触发）
 * split-chunks-demo.js   = 自动分割（SplitChunksPlugin 根据策略自动提取公共代码）
 *
 * 两者互补：
 *   import() 决定"在哪里拆"（分割点）
 *   SplitChunksPlugin 决定"拆出来的 chunk 怎么优化"（公共模块提取、vendor 分离）
 *
 * ═══════════════════════════════════════════════════════
 *  为什么需要 SplitChunksPlugin？
 * ═══════════════════════════════════════════════════════
 *
 * 场景：多入口 / 多异步 chunk 共享同一个大依赖
 *
 *   pageA.js → import lodash (500KB) + import utils (10KB)
 *   pageB.js → import lodash (500KB) + import helpers (8KB)
 *
 * 不优化：lodash 被打包两次（pageA 一份、pageB 一份）→ 浪费 500KB
 * 优化后：lodash 提取到 vendors~pageA~pageB.js → 只加载一次 → 还能被浏览器缓存
 *
 * ═══════════════════════════════════════════════════════
 *  SplitChunksPlugin 的核心配置
 * ═══════════════════════════════════════════════════════
 *
 *  optimization: {
 *    splitChunks: {
 *      chunks: 'all',         // 对同步和异步 chunk 都生效
 *      minSize: 20000,        // 被提取的模块最小体积（字节）
 *      minChunks: 1,          // 最少被引用次数
 *      maxAsyncRequests: 30,  // 异步加载时最大并行请求数
 *      maxInitialRequests: 30,// 入口点最大并行请求数
 *      cacheGroups: {
 *        vendors: {
 *          test: /[\\/]node_modules[\\/]/,
 *          priority: -10,     // 优先级（越大越优先匹配）
 *          name: 'vendors',
 *        },
 *        common: {
 *          minChunks: 2,      // 被 2 个以上 chunk 引用才提取
 *          priority: -20,
 *          reuseExistingChunk: true,
 *        },
 *      },
 *    },
 *  }
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现的核心逻辑
 * ═══════════════════════════════════════════════════════
 *
 *  阶段 1: 多入口构建 → 为每个入口解析依赖图
 *  阶段 2: 分析模块引用关系 → 找出被多个 chunk 共享的模块
 *  阶段 3: 应用分包策略（cacheGroups 匹配）→ 决定哪些模块提取到公共 chunk
 *  阶段 4: 生成优化后的 chunk 分配结果
 *
 * 运行方式：node WebPack/split-chunks-demo.js
 */

// ─── 示例项目结构 ─────────────────────────────────────────────────────────
//
// 模拟一个多页应用：两个入口（pageA, pageB），共享一些依赖
//
//   pageA.js → lodash (大依赖) + shared-utils + componentA
//   pageB.js → lodash (大依赖) + shared-utils + componentB
//   pageA.js → import('./async-chart')  (异步 chunk)
//   pageB.js → import('./async-chart')  (异步 chunk，同一个模块)
//
// 期望优化结果：
//   vendors.js      ← lodash（node_modules 大依赖，单独提取）
//   common.js       ← shared-utils（被多入口共用）
//   async-common.js ← async-chart（被多个异步 import 共用）
//   pageA.js        ← componentA + 入口逻辑
//   pageB.js        ← componentB + 入口逻辑

const modules = {
  // ── node_modules ──
  "node_modules/lodash/index.js": {
    size: 530000,  // 530KB 模拟大依赖
    isNodeModule: true,
    code: "module.exports = { chunk: fn, map: fn, ... }; // lodash 530KB",
  },

  // ── 公共模块 ──
  "src/shared-utils.js": {
    size: 15000,   // 15KB
    isNodeModule: false,
    code: "export function formatDate(d) { ... }\nexport function debounce(fn, ms) { ... }",
  },

  // ── 页面独有模块 ──
  "src/componentA.js": {
    size: 25000,   // 25KB
    isNodeModule: false,
    code: "export default function ComponentA() { ... }",
  },
  "src/componentB.js": {
    size: 20000,   // 20KB
    isNodeModule: false,
    code: "export default function ComponentB() { ... }",
  },

  // ── 异步模块 ──
  "src/async-chart.js": {
    size: 80000,   // 80KB
    isNodeModule: false,
    code: "export function renderChart(data) { ... } // 图表库 80KB",
  },

  // ── 入口 ──
  "src/pageA.js": {
    size: 5000,
    isNodeModule: false,
    code: "import lodash; import shared-utils; import componentA; import('./async-chart');",
    deps: ["node_modules/lodash/index.js", "src/shared-utils.js", "src/componentA.js"],
    asyncDeps: ["src/async-chart.js"],
  },
  "src/pageB.js": {
    size: 4000,
    isNodeModule: false,
    code: "import lodash; import shared-utils; import componentB; import('./async-chart');",
    deps: ["node_modules/lodash/index.js", "src/shared-utils.js", "src/componentB.js"],
    asyncDeps: ["src/async-chart.js"],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 1：构建 chunk 依赖图
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack Compilation.seal() 阶段：
// 遍历所有入口，收集每个 chunk 包含的模块

function buildChunks(entries) {
  const chunks = {};

  entries.forEach(({ name, entry }) => {
    const chunk = {
      name,
      entry,
      syncModules: new Set(),   // 同步依赖的所有模块
      asyncDeps: new Set(),     // 异步 import() 的目标
    };

    // 收集同步依赖（递归）
    function collectSync(moduleId) {
      if (chunk.syncModules.has(moduleId)) return;
      chunk.syncModules.add(moduleId);
      const mod = modules[moduleId];
      if (mod && mod.deps) {
        mod.deps.forEach((dep) => collectSync(dep));
      }
    }

    collectSync(entry);

    // 收集异步依赖
    const mod = modules[entry];
    if (mod && mod.asyncDeps) {
      mod.asyncDeps.forEach((dep) => chunk.asyncDeps.add(dep));
    }

    chunks[name] = chunk;
  });

  // 为异步依赖也创建 chunk
  const asyncChunkModules = {};
  Object.values(chunks).forEach((chunk) => {
    chunk.asyncDeps.forEach((dep) => {
      if (!asyncChunkModules[dep]) asyncChunkModules[dep] = new Set();
      asyncChunkModules[dep].add(chunk.name);
    });
  });

  for (const [moduleId, fromChunks] of Object.entries(asyncChunkModules)) {
    const chunkName = "async-" + moduleId.replace("src/", "").replace(".js", "");
    chunks[chunkName] = {
      name: chunkName,
      entry: moduleId,
      syncModules: new Set([moduleId]),
      asyncDeps: new Set(),
      isAsync: true,
      requestedBy: fromChunks,
    };
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 2：分析模块被引用情况
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 的 ChunkGraph：
// 记录每个模块被哪些 chunk 包含，用于判断是否需要提取

function analyzeModuleUsage(chunks) {
  const moduleToChunks = {};  // { moduleId: Set<chunkName> }

  for (const [chunkName, chunk] of Object.entries(chunks)) {
    chunk.syncModules.forEach((moduleId) => {
      if (!moduleToChunks[moduleId]) moduleToChunks[moduleId] = new Set();
      moduleToChunks[moduleId].add(chunkName);
    });
  }

  return moduleToChunks;
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 3：应用 SplitChunks 策略
// ═══════════════════════════════════════════════════════════════════════════
//
// 核心算法：
//   1. 遍历所有模块
//   2. 对每个模块，按优先级匹配 cacheGroup
//   3. 判断是否满足 minSize / minChunks 等条件
//   4. 满足则将模块从原 chunk 移到新的 split chunk
//
// 对应 webpack 源码：
//   SplitChunksPlugin._getMaxSizeQueueForChunk()
//   SplitChunksPlugin._addModule()
//
// 简化点：
//   - 不实现 maxAsyncRequests / maxInitialRequests 限制
//   - 不实现 reuseExistingChunk 复用逻辑
//   - 不实现 automaticNameDelimiter 命名规则

function applySplitChunks(chunks, moduleToChunks, config) {
  const splitResult = {
    newChunks: {},      // 新提取出的 chunk
    removals: [],       // 从原 chunk 中移除的记录
    decisions: [],      // 决策日志
  };

  // 按优先级排序 cacheGroups
  const groups = Object.entries(config.cacheGroups)
    .map(([name, group]) => ({ name, ...group }))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // 遍历所有模块
  for (const [moduleId, chunkSet] of Object.entries(moduleToChunks)) {
    const mod = modules[moduleId];
    if (!mod) continue;

    // 跳过入口模块本身（入口不能被提取走）
    const isEntry = Object.values(chunks).some((c) => c.entry === moduleId && !c.isAsync);
    if (isEntry) {
      splitResult.decisions.push({
        module: moduleId,
        action: "SKIP",
        reason: "入口模块，不能提取",
      });
      continue;
    }

    // 尝试匹配 cacheGroup（按优先级）
    let matched = false;
    for (const group of groups) {
      // ── 检查 test 条件 ──
      if (group.test) {
        const testResult = typeof group.test === "function"
          ? group.test(moduleId, mod)
          : group.test.test(moduleId);
        if (!testResult) continue;
      }

      // ── 检查 minChunks ──
      const minChunks = group.minChunks || config.minChunks || 1;
      if (chunkSet.size < minChunks) {
        splitResult.decisions.push({
          module: moduleId,
          action: "SKIP",
          group: group.name,
          reason: `引用次数 ${chunkSet.size} < minChunks ${minChunks}`,
        });
        continue;
      }

      // ── 检查 minSize ──
      const minSize = group.minSize !== undefined ? group.minSize : (config.minSize || 20000);
      if (mod.size < minSize) {
        splitResult.decisions.push({
          module: moduleId,
          action: "SKIP",
          group: group.name,
          reason: `体积 ${formatSize(mod.size)} < minSize ${formatSize(minSize)}`,
        });
        continue;
      }

      // ── 通过所有条件，执行提取 ──
      const targetChunkName = group.name || ("split-" + group.name);

      if (!splitResult.newChunks[targetChunkName]) {
        splitResult.newChunks[targetChunkName] = {
          name: targetChunkName,
          modules: [],
          totalSize: 0,
          fromGroup: group.name,
        };
      }

      splitResult.newChunks[targetChunkName].modules.push(moduleId);
      splitResult.newChunks[targetChunkName].totalSize += mod.size;

      // 记录从哪些 chunk 中移除
      chunkSet.forEach((chunkName) => {
        splitResult.removals.push({ module: moduleId, fromChunk: chunkName });
      });

      splitResult.decisions.push({
        module: moduleId,
        action: "SPLIT",
        group: group.name,
        targetChunk: targetChunkName,
        reason: `满足条件: size=${formatSize(mod.size)}, chunks=${chunkSet.size}, ` +
                `test=${group.test ? "匹配" : "无"}, priority=${group.priority}`,
      });

      matched = true;
      break;  // 只匹配第一个（最高优先级）cacheGroup
    }

    if (!matched) {
      splitResult.decisions.push({
        module: moduleId,
        action: "KEEP",
        reason: "不匹配任何 cacheGroup，保留在原 chunk",
      });
    }
  }

  return splitResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 4：生成最终 chunk 分配
// ═══════════════════════════════════════════════════════════════════════════

function generateFinalChunks(chunks, splitResult) {
  const finalChunks = {};

  // 复制原始 chunk，移除被提取的模块
  const removedFromChunk = {};
  splitResult.removals.forEach(({ module: mod, fromChunk }) => {
    if (!removedFromChunk[fromChunk]) removedFromChunk[fromChunk] = new Set();
    removedFromChunk[fromChunk].add(mod);
  });

  for (const [name, chunk] of Object.entries(chunks)) {
    const removed = removedFromChunk[name] || new Set();
    const remaining = [...chunk.syncModules].filter((m) => !removed.has(m));
    const totalSize = remaining.reduce((sum, m) => sum + (modules[m]?.size || 0), 0);

    finalChunks[name] = {
      name,
      modules: remaining,
      totalSize,
      isAsync: chunk.isAsync || false,
    };
  }

  // 添加 split 出来的新 chunk
  for (const [name, splitChunk] of Object.entries(splitResult.newChunks)) {
    finalChunks[name] = {
      name,
      modules: splitChunk.modules,
      totalSize: splitChunk.totalSize,
      isSplit: true,
      fromGroup: splitChunk.fromGroup,
    };
  }

  return finalChunks;
}

// ─── 工具 ────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + "MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + "KB";
  return bytes + "B";
}

// ═══════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== SplitChunksPlugin 分包策略演示 ===\n");

// ── 配置 ──
const splitChunksConfig = {
  chunks: "all",
  minSize: 10000,       // 10KB 以上才提取
  minChunks: 1,
  cacheGroups: {
    vendors: {
      test: /node_modules/,
      priority: -10,
      name: "vendors",
      minChunks: 1,
      minSize: 0,       // vendor 不限大小
    },
    common: {
      test: null,        // 不限来源
      minChunks: 2,      // 被 2 个以上 chunk 引用
      priority: -20,
      name: "common",
      minSize: 10000,
    },
  },
};

// ── 多入口 ──
const entries = [
  { name: "pageA", entry: "src/pageA.js" },
  { name: "pageB", entry: "src/pageB.js" },
];

// 阶段 1
console.log("【阶段 1】构建 chunk 依赖图\n");
const chunks = buildChunks(entries);

for (const [name, chunk] of Object.entries(chunks)) {
  const mods = [...chunk.syncModules];
  const totalSize = mods.reduce((sum, m) => sum + (modules[m]?.size || 0), 0);
  console.log(`  ${name}${chunk.isAsync ? " (async)" : ""}:`);
  mods.forEach((m) => {
    console.log(`    ${m} (${formatSize(modules[m]?.size || 0)})`);
  });
  console.log(`    总计: ${formatSize(totalSize)}`);
  console.log();
}

// 阶段 2
console.log("【阶段 2】分析模块引用关系\n");
const moduleToChunks = analyzeModuleUsage(chunks);

for (const [moduleId, chunkSet] of Object.entries(moduleToChunks)) {
  const chunkNames = [...chunkSet].join(", ");
  const shared = chunkSet.size > 1 ? " ← 共享!" : "";
  console.log(`  ${moduleId} → 被 [${chunkNames}] 引用${shared}`);
}

// 阶段 3
console.log("\n\n【阶段 3】应用 SplitChunks 策略\n");
console.log("  配置:");
console.log(`    minSize: ${formatSize(splitChunksConfig.minSize)}`);
console.log(`    cacheGroups:`);
console.log(`      vendors: test=/node_modules/, priority=-10, minChunks=1`);
console.log(`      common:  minChunks=2, priority=-20, minSize=${formatSize(splitChunksConfig.cacheGroups.common.minSize)}\n`);

const splitResult = applySplitChunks(chunks, moduleToChunks, splitChunksConfig);

console.log("  决策过程:");
splitResult.decisions.forEach((d) => {
  const icon = d.action === "SPLIT" ? "→ SPLIT" : d.action === "SKIP" ? "  SKIP " : "  KEEP ";
  const group = d.group ? ` [${d.group}]` : "";
  const target = d.targetChunk ? ` → ${d.targetChunk}` : "";
  console.log(`    ${icon}${group} ${d.module}${target}`);
  console.log(`           ${d.reason}`);
});

// 阶段 4
console.log("\n\n【阶段 4】最终 chunk 分配\n");
const finalChunks = generateFinalChunks(chunks, splitResult);

console.log("─".repeat(60));
let totalBefore = 0;
let totalAfter = 0;

// 先计算优化前总大小
for (const [, chunk] of Object.entries(chunks)) {
  const mods = [...chunk.syncModules];
  totalBefore += mods.reduce((sum, m) => sum + (modules[m]?.size || 0), 0);
}

for (const [name, chunk] of Object.entries(finalChunks)) {
  const tag = chunk.isSplit ? " [SPLIT]" : chunk.isAsync ? " [ASYNC]" : "";
  const from = chunk.fromGroup ? ` (from cacheGroup: ${chunk.fromGroup})` : "";
  console.log(`  ${name}${tag}${from}: ${formatSize(chunk.totalSize)}`);
  chunk.modules.forEach((m) => {
    console.log(`    - ${m} (${formatSize(modules[m]?.size || 0)})`);
  });
  totalAfter += chunk.totalSize;
}

console.log("─".repeat(60));

// ═══════════════════════════════════════════════════════════════════════════
// 对比总结
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n\n" + "═".repeat(60));
console.log("【优化对比】");
console.log("═".repeat(60));

console.log("\n  优化前（不分包）:");
console.log(`    pageA.js: ${formatSize(5000 + 530000 + 15000 + 25000)} (lodash + shared-utils + componentA + 入口)`);
console.log(`    pageB.js: ${formatSize(4000 + 530000 + 15000 + 20000)} (lodash + shared-utils + componentB + 入口)`);
console.log(`    async-async-chart.js: ${formatSize(80000)} (各自一份 → 可能重复)`);
console.log(`    总下载: ${formatSize(5000 + 530000 + 15000 + 25000 + 4000 + 530000 + 15000 + 20000 + 80000 * 2)}`);

console.log("\n  优化后（SplitChunks）:");
for (const [name, chunk] of Object.entries(finalChunks)) {
  console.log(`    ${name}.js: ${formatSize(chunk.totalSize)}`);
}
console.log(`    总下载: ${formatSize(totalAfter)}`);
console.log(`    节省: ${formatSize(totalBefore - totalAfter)} (lodash 不再重复打包 + shared-utils 提取公共)`);

console.log("\n  缓存优势:");
console.log("    vendors.js (lodash) → 很少变化 → 长期缓存 (contenthash)");
console.log("    common.js (shared-utils) → 偶尔变化 → 中期缓存");
console.log("    pageA/pageB.js (业务代码) → 频繁变化 → 短期缓存");
console.log("    用户访问 pageB 时，vendors.js 和 common.js 已在缓存中 → 只需下载 pageB.js");

console.log("\n  面试重点配置项:");
console.log("    chunks: 'all'      → 同步 + 异步都优化（推荐）");
console.log("    chunks: 'async'    → 只优化异步（默认值）");
console.log("    chunks: 'initial'  → 只优化同步");
console.log("    minSize: 20000     → 小于 20KB 不提取（避免请求数太多）");
console.log("    minChunks: 2       → 至少被 2 个 chunk 引用才提取");
console.log("    cacheGroups        → 分组规则，priority 决定优先级");
console.log("    name               → 生成的 chunk 名（影响 contenthash 缓存）");
