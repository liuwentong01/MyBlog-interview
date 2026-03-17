/**
 * Scope Hoisting（作用域提升）实现演示
 *
 * ═══════════════════════════════════════════════════════
 *  核心原理
 * ═══════════════════════════════════════════════════════
 *
 * 默认打包：每个模块包在一个函数闭包里
 *   modules["math.js"] = (module, exports, require) => { ... }
 *   modules["index.js"] = (module, exports, require) => { ... }
 *
 * Scope Hoisting：把多个模块合并到同一个函数作用域
 *   (() => {
 *     // math.js 的代码直接内联
 *     const add = (a, b) => a + b;
 *     // index.js 的代码
 *     console.log(add(1, 2));
 *   })();
 *
 * ═══════════════════════════════════════════════════════
 *  为什么要做 Scope Hoisting？
 * ═══════════════════════════════════════════════════════
 *
 * 1. 减少函数闭包数量
 *    - 普通打包：100 个模块 = 100 个函数闭包 + modules 对象 + require 运行时
 *    - Scope Hoisting：所有模块合并到一个函数（或少数几个函数）
 *    - 更少的函数声明 = 更少的作用域 = 更少的内存消耗
 *
 * 2. 减少代码体积
 *    - 去掉了每个模块的 (module, exports, require) => { } 包装
 *    - 去掉了 modules 对象、cache 对象、require 函数等运行时代码
 *    - 变量名可以被压缩工具更好地优化（同一作用域内的死代码更容易发现）
 *
 * 3. 提升运行性能
 *    - require() 有函数调用开销 + cache 查找开销
 *    - Scope Hoisting 后变成直接变量引用，V8 可以内联优化
 *
 * ═══════════════════════════════════════════════════════
 *  前提条件：必须是 ESM
 * ═══════════════════════════════════════════════════════
 *
 * Scope Hoisting 只对 ES Module 生效，CJS 不行：
 *   - ESM 的 import/export 是静态的 → 编译期能确定模块间的绑定关系
 *   - CJS 的 require() 返回值是个对象 → 不能简单地把属性"拉平"到外层作用域
 *     因为 require 的返回值可能被动态修改、传递给其他函数等
 *
 * webpack 中通过 optimization.concatenateModules: true 开启（生产模式默认开启）
 * 内部叫 ModuleConcatenationPlugin
 *
 * ═══════════════════════════════════════════════════════
 *  哪些模块不能被合并？
 * ═══════════════════════════════════════════════════════
 *
 * 1. 非 ESM 模块（CJS / AMD / UMD）
 * 2. 被多个 chunk 引用的模块（因为合并后就不能共享了）
 * 3. 有副作用且 export 被外部使用的模块（合并后执行顺序可能变）
 * 4. 使用了 eval() 的模块（eval 会访问当前作用域的变量）
 * 5. 包含循环依赖的模块组（变量提升顺序无法保证）
 *
 * ═══════════════════════════════════════════════════════
 *  本文件的 3 个阶段
 * ═══════════════════════════════════════════════════════
 *
 * 阶段 1: 构建模块依赖图 + 判断哪些模块可以合并
 * 阶段 2: 将可合并的模块"内联"到消费方，重命名避免冲突
 * 阶段 3: 生成两种产物对比（普通 bundle vs Scope Hoisting bundle）
 *
 * 运行方式：cd WebPack/mini-webpack && npm install && cd .. && node scope-hoisting-demo.js
 */

const parser = require("./mini-webpack/node_modules/@babel/parser");
const traverse = require("./mini-webpack/node_modules/@babel/traverse").default;
const generator = require("./mini-webpack/node_modules/@babel/generator").default;
const types = require("./mini-webpack/node_modules/@babel/types");

// ─── 示例源码（全部 ESM）────────────────────────────────────────────────────

const files = {
  "./src/math.js": `
export const add = (a, b) => a + b;
export const subtract = (a, b) => a - b;
export const multiply = (a, b) => a * b;
`,

  "./src/utils.js": `
export function formatResult(label, value) {
  return '[' + label + '] ' + value;
}
export function log(msg) {
  console.log('LOG: ' + msg);
}
`,

  "./src/index.js": `
import { add, subtract } from './math';
import { formatResult } from './utils';

const result1 = formatResult('add', add(10, 5));
const result2 = formatResult('subtract', subtract(10, 5));
console.log(result1);
console.log(result2);
`,
};

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 1：分析模块依赖图 + 判断可合并性
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 的 ModuleConcatenationPlugin 的第一步：
// 1. 遍历所有模块，检查是否全部使用 ESM
// 2. 检查是否有循环依赖（有循环的不能合并）
// 3. 检查是否被多个 chunk 引用（被多个引用的不能合并）
// 4. 构建"合并组"（ConcatenatedModule）

function resolveModule(importPath) {
  let r = importPath;
  if (!r.startsWith("./src/")) r = "./src/" + r.replace("./", "");
  if (!r.endsWith(".js")) r += ".js";
  return r;
}

function analyzeModule(moduleId, source) {
  const ast = parser.parse(source, { sourceType: "module" });
  const imports = [];   // { source, specifiers: [{ imported, local }] }
  const exports = [];   // { name, localName }

  traverse(ast, {
    ImportDeclaration({ node }) {
      const src = resolveModule(node.source.value);
      const specifiers = node.specifiers.map((s) => {
        if (s.type === "ImportSpecifier") {
          return { imported: s.imported.name, local: s.local.name };
        }
        if (s.type === "ImportDefaultSpecifier") {
          return { imported: "default", local: s.local.name };
        }
        return { imported: "*", local: s.local.name };
      });
      imports.push({ source: src, specifiers });
    },
    ExportNamedDeclaration({ node }) {
      if (node.declaration) {
        if (node.declaration.type === "VariableDeclaration") {
          node.declaration.declarations.forEach((d) => {
            exports.push({ name: d.id.name, localName: d.id.name });
          });
        } else if (node.declaration.id) {
          exports.push({ name: node.declaration.id.name, localName: node.declaration.id.name });
        }
      }
    },
    ExportDefaultDeclaration() {
      exports.push({ name: "default", localName: "_default" });
    },
  });

  return { moduleId, imports, exports, source };
}

// 检测循环依赖
function hasCycle(moduleId, graph, visited, stack) {
  visited.add(moduleId);
  stack.add(moduleId);
  const mod = graph[moduleId];
  if (mod) {
    for (const imp of mod.imports) {
      if (stack.has(imp.source)) return true;
      if (!visited.has(imp.source) && hasCycle(imp.source, graph, visited, stack)) return true;
    }
  }
  stack.delete(moduleId);
  return false;
}

function buildModuleGraph(entryId) {
  const graph = {};
  const importCounts = {}; // 被引用次数

  function visit(moduleId) {
    if (graph[moduleId]) return;
    const source = files[moduleId];
    if (!source) return;
    const info = analyzeModule(moduleId, source);
    graph[moduleId] = info;

    info.imports.forEach((imp) => {
      importCounts[imp.source] = (importCounts[imp.source] || 0) + 1;
      visit(imp.source);
    });
  }

  visit(entryId);

  // 判断哪些模块可以合并
  const canConcatenate = {};
  const cycleDetected = hasCycle(entryId, graph, new Set(), new Set());

  for (const [id, mod] of Object.entries(graph)) {
    const reasons = [];

    // 入口模块作为根，不"合并到别人里"（但别人会合并到它里面）
    if (id === entryId) {
      canConcatenate[id] = { can: true, isRoot: true, reasons: ["入口模块（根）"] };
      continue;
    }

    // 检查是否被多个模块引用
    if ((importCounts[id] || 0) > 1) {
      reasons.push(`被 ${importCounts[id]} 个模块引用（只被 1 个引用才能合并）`);
    }

    // 检查循环依赖
    if (cycleDetected) {
      // 简化处理：如果整个图有环，标记所有非入口模块
      // 真实 webpack 会精确判断哪些模块在环中
      reasons.push("存在循环依赖");
    }

    canConcatenate[id] = {
      can: reasons.length === 0,
      isRoot: false,
      reasons: reasons.length ? reasons : ["可以合并"],
    };
  }

  return { graph, canConcatenate };
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 2：执行合并（核心！）
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack ModuleConcatenationPlugin 的核心逻辑：
//
// 关键步骤：
//   1. 对每个被合并的模块，生成唯一前缀（如 math_ / utils_）避免变量名冲突
//   2. 将 export 声明转为普通变量声明（去掉 export 关键字）
//   3. 将变量名加上模块前缀（add → math_add）
//   4. 在消费方，把 import 的引用替换为带前缀的变量名
//   5. 删除 import/export 语句，将代码内联到根模块中
//
// 为什么需要重命名？
//   两个模块可能有同名变量：
//     math.js: const result = 1;
//     utils.js: const result = 2;
//   合并到同一作用域后会冲突，所以必须加前缀区分

function scopeHoist(entryId, graph, canConcatenate) {
  // 收集所有可合并的模块
  const mergeableModules = {};
  for (const [id, info] of Object.entries(canConcatenate)) {
    if (info.can && !info.isRoot) {
      mergeableModules[id] = graph[id];
    }
  }

  // 为每个可合并模块生成前缀
  const prefixes = {};
  for (const id of Object.keys(mergeableModules)) {
    // ./src/math.js → math_
    const base = id.replace("./src/", "").replace(".js", "").replace(/[^a-zA-Z0-9]/g, "_");
    prefixes[id] = base + "_";
  }

  // ── 步骤 A：处理可合并模块（去 export，加前缀）────────────────────────
  //
  // export const add = (a, b) => a + b;
  //   → const math_add = (a, b) => a + b;
  //
  // 收集导出映射：{ moduleId: { exportName: prefixedName } }
  const exportMappings = {};

  const inlinedCode = {};
  for (const [id, mod] of Object.entries(mergeableModules)) {
    const prefix = prefixes[id];
    const ast = parser.parse(mod.source, { sourceType: "module" });
    const mapping = {};

    // 第一遍：收集所有导出名到前缀名的映射
    traverse(ast, {
      ExportNamedDeclaration({ node }) {
        if (node.declaration) {
          if (node.declaration.type === "VariableDeclaration") {
            node.declaration.declarations.forEach((d) => {
              mapping[d.id.name] = prefix + d.id.name;
            });
          } else if (node.declaration.id) {
            mapping[node.declaration.id.name] = prefix + node.declaration.id.name;
          }
        }
      },
    });

    // 第二遍：去掉 export 关键字 + 重命名
    traverse(ast, {
      ExportNamedDeclaration(nodePath) {
        if (nodePath.node.declaration) {
          nodePath.replaceWith(nodePath.node.declaration);
        }
      },
      // 重命名所有引用了导出变量的标识符
      Identifier(nodePath) {
        if (mapping[nodePath.node.name]) {
          // 只重命名引用（不重命名对象属性的 key）
          if (nodePath.parent.type === "MemberExpression" && nodePath.key === "property" && !nodePath.parent.computed) {
            return;
          }
          if (nodePath.parent.type === "ObjectProperty" && nodePath.key === "key" && !nodePath.parent.computed) {
            return;
          }
          nodePath.node.name = mapping[nodePath.node.name];
        }
      },
      // 删除 import 语句（合并后不再需要）
      ImportDeclaration(nodePath) {
        nodePath.remove();
      },
    });

    exportMappings[id] = mapping;
    inlinedCode[id] = generator(ast).code.trim();
  }

  // ── 步骤 B：处理根模块（替换 import 引用为前缀变量名）─────────────────
  //
  // import { add } from './math';
  // console.log(add(1, 2));
  //   → console.log(math_add(1, 2));
  //   （import 语句删除，add 替换为 math_add）

  const rootSource = graph[entryId].source;
  const rootAst = parser.parse(rootSource, { sourceType: "module" });

  // 收集 import 绑定到前缀名的映射
  const localToPrefix = {};
  const importsToRemove = new Set();

  traverse(rootAst, {
    ImportDeclaration(nodePath) {
      const src = resolveModule(nodePath.node.source.value);
      const mapping = exportMappings[src];

      if (mapping) {
        // 这个模块被合并了，收集映射关系
        nodePath.node.specifiers.forEach((s) => {
          if (s.type === "ImportSpecifier") {
            const prefixed = mapping[s.imported.name];
            if (prefixed) {
              localToPrefix[s.local.name] = prefixed;
            }
          }
        });
        importsToRemove.add(nodePath);
      }
    },
  });

  // 删除合并模块的 import 语句 + 替换变量引用
  traverse(rootAst, {
    ImportDeclaration(nodePath) {
      const src = resolveModule(nodePath.node.source.value);
      if (exportMappings[src]) {
        nodePath.remove();
      }
    },
    Identifier(nodePath) {
      if (localToPrefix[nodePath.node.name]) {
        if (nodePath.parent.type === "ImportSpecifier") return;
        nodePath.node.name = localToPrefix[nodePath.node.name];
      }
    },
  });

  const rootCode = generator(rootAst).code.trim();

  // ── 步骤 C：组装最终产物 ──────────────────────────────────────────────
  //
  // 顺序：被依赖的模块在前（先声明变量），入口模块在后（使用变量）
  // 这就是"提升"——把依赖模块的代码提升到入口模块之前

  const parts = [];
  // 按依赖拓扑顺序排列（简化：leaf 模块在前）
  const entryInfo = graph[entryId];
  const ordered = [];
  const added = new Set();
  function addInOrder(moduleId) {
    if (added.has(moduleId)) return;
    if (!mergeableModules[moduleId]) return;
    const mod = graph[moduleId];
    mod.imports.forEach((imp) => addInOrder(imp.source));
    added.add(moduleId);
    ordered.push(moduleId);
  }
  entryInfo.imports.forEach((imp) => addInOrder(imp.source));

  ordered.forEach((id) => {
    parts.push(`  // ── ${id} (inlined) ──`);
    parts.push("  " + inlinedCode[id].split("\n").join("\n  "));
  });

  parts.push("");
  parts.push(`  // ── ${entryId} (root) ──`);
  parts.push("  " + rootCode.split("\n").join("\n  "));

  return `/* === Scope Hoisting Bundle === */
(() => {
${parts.join("\n")}
})();`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 对比：生成普通 bundle（不做 Scope Hoisting）
// ═══════════════════════════════════════════════════════════════════════════
//
// 普通方式：每个模块一个闭包 + require 运行时
// 与 mini-webpack 的 getSource 完全一致

function generateNormalBundle(graph, entryId) {
  const processed = {};

  for (const [id, mod] of Object.entries(graph)) {
    const ast = parser.parse(mod.source, { sourceType: "module" });

    traverse(ast, {
      ImportDeclaration(nodePath) {
        const src = resolveModule(nodePath.node.source.value);
        const specifiers = nodePath.node.specifiers;
        if (!specifiers.length) {
          nodePath.replaceWith(
            types.expressionStatement(
              types.callExpression(types.identifier("require"), [types.stringLiteral(src)])
            )
          );
          return;
        }
        const properties = specifiers
          .filter((s) => s.type === "ImportSpecifier")
          .map((s) =>
            types.objectProperty(
              types.identifier(s.imported.name),
              types.identifier(s.local.name),
              false,
              s.imported.name === s.local.name
            )
          );
        nodePath.replaceWith(
          types.variableDeclaration("const", [
            types.variableDeclarator(
              types.objectPattern(properties),
              types.callExpression(types.identifier("require"), [types.stringLiteral(src)])
            ),
          ])
        );
      },
      ExportNamedDeclaration(nodePath) {
        const { node } = nodePath;
        if (node.declaration) {
          const names =
            node.declaration.type === "VariableDeclaration"
              ? node.declaration.declarations.map((d) => d.id.name)
              : [node.declaration.id.name];
          nodePath.replaceWith(node.declaration);
          names.forEach((name) => {
            nodePath.insertAfter(
              types.expressionStatement(
                types.assignmentExpression(
                  "=",
                  types.memberExpression(types.identifier("exports"), types.identifier(name)),
                  types.identifier(name)
                )
              )
            );
          });
        }
      },
    });

    processed[id] = generator(ast).code;
  }

  const moduleEntries = Object.entries(processed)
    .map(([id, code]) => {
      const indented = code.split("\n").map((l) => "      " + l).join("\n");
      return `    "${id}": (module, exports, require) => {\n${indented}\n    }`;
    })
    .join(",\n");

  return `/* === Normal Bundle (每个模块一个闭包) === */
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
  require("${entryId}");
})();`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Scope Hoisting 演示 ===\n");

const entryId = "./src/index.js";
const { graph, canConcatenate } = buildModuleGraph(entryId);

// 打印模块图分析结果
console.log("【阶段 1】模块依赖图分析\n");
for (const [id, mod] of Object.entries(graph)) {
  const deps = mod.imports.map((i) => i.source).join(", ") || "(无依赖)";
  const status = canConcatenate[id];
  const flag = status.can ? (status.isRoot ? "ROOT" : "✓ 可合并") : "✗ 不可合并";
  console.log(`  ${id}`);
  console.log(`    依赖: ${deps}`);
  console.log(`    状态: ${flag} — ${status.reasons.join("; ")}`);
}

// 生成普通 bundle
console.log("\n\n【阶段 2】对比产物\n");
console.log("─".repeat(60));
console.log("方式 A：普通打包（每个模块一个闭包）");
console.log("─".repeat(60));
const normalBundle = generateNormalBundle(graph, entryId);
console.log(normalBundle);

console.log("\n--- 执行结果 ---");
eval(normalBundle);

// 生成 Scope Hoisting bundle
console.log("\n\n" + "─".repeat(60));
console.log("方式 B：Scope Hoisting（模块合并到同一作用域）");
console.log("─".repeat(60));
const hoistedBundle = scopeHoist(entryId, graph, canConcatenate);
console.log(hoistedBundle);

console.log("\n--- 执行结果 ---");
eval(hoistedBundle);

// 对比分析
console.log("\n\n" + "═".repeat(60));
console.log("【对比分析】");
console.log("═".repeat(60));
console.log(`\n  普通 bundle: ${normalBundle.length} 字符`);
console.log(`  Hoisted bundle: ${hoistedBundle.length} 字符`);
console.log(`  体积减少: ${normalBundle.length - hoistedBundle.length} 字符 (${((1 - hoistedBundle.length / normalBundle.length) * 100).toFixed(1)}%)`);
console.log("\n  普通 bundle:");
console.log("    - 3 个函数闭包 (module, exports, require) => { ... }");
console.log("    - 1 个 modules 对象");
console.log("    - 1 个 cache 对象");
console.log("    - 1 个 require 函数");
console.log("    - 运行时: require() 函数调用 + cache 查找");
console.log("\n  Scope Hoisting bundle:");
console.log("    - 0 个闭包，所有代码在同一个 IIFE 内");
console.log("    - 0 个运行时代码（没有 modules/cache/require）");
console.log("    - 模块间引用变成直接变量引用（math_add 而非 require('./math').add）");
console.log("    - V8 可以内联优化，性能更好");

console.log("\n  webpack 开启方式:");
console.log("    optimization: { concatenateModules: true }  // 生产模式默认开启");
console.log("    或者手动: new webpack.optimize.ModuleConcatenationPlugin()");

console.log("\n  不能合并的情况 (bail out):");
console.log("    1. 模块使用了 CommonJS (require/module.exports)");
console.log("    2. 模块被多个 chunk 引用");
console.log("    3. 模块在循环依赖中");
console.log("    4. 模块中使用了 eval()");
console.log("    5. 非 ESM 格式 (AMD/UMD)");
console.log("    查看 bail out 原因: --stats-optimization-bailout");
