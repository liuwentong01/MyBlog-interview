/**
 * Tree Shaking 实现演示
 *
 * ═══════════════════════════════════════════════════════
 *  核心原理
 * ═══════════════════════════════════════════════════════
 *
 * Tree Shaking 是基于 ES Module 静态结构的死代码消除技术。
 *
 * 为什么 CommonJS 做不了 Tree Shaking？
 *   const math = require('./math')   ← 运行时执行，编译期不知道用了什么
 *   math[dynamicKey]()               ← 动态属性访问，根本无法分析
 *
 * 为什么 ES Module 可以？
 *   import { add } from './math'     ← 静态声明，编译期就确定了只用 add
 *   export const add = ...           ← 静态声明，编译期就确定了导出 add
 *   
 * @TODO 为什么CommonJS做不了Tree Shaking？ 给我讲讲 （我理解可以通过require静态分析引用的哪些模块呀，  math[dynamicKey]()dynamicKey为什么是动态的）
 * ═══════════════════════════════════════════════════════
 *  webpack 的真实流程（5 步）
 * ═══════════════════════════════════════════════════════
 *
 *  1. 收集导出（Provide）
 *     遍历模块 AST，记录 export 声明
 *     math.js → providedExports: ['add', 'subtract', 'multiply', 'PI']
 *
 *  2. 收集使用（Use）
 *     遍历消费方 AST，记录 import 的标识符
 *     index.js → import { add, subtract } from './math'
 *     → math.js.usedExports: ['add', 'subtract']
 *
 *  3. 标记（FlagDependencyUsagePlugin）
 *     对比 provided 和 used：
 *       add       → used ✓
 *       subtract  → used ✓
 *       multiply  → unused ✗
 *       PI        → unused ✗
 *
 *  4. 代码生成
 *     unused 的导出去掉 export 关键字 → 变成模块内的局部变量
 *     并添加 /* unused harmony export multiply *\/ 注释
 *
 *  5. Terser 压缩
 *     发现 multiply、PI 是无引用的局部变量 → 作为死代码删除
 *
 * ═══════════════════════════════════════════════════════
 *  本文件简化点
 * ═══════════════════════════════════════════════════════
 *
 *  - 只处理命名导出（export const / export function），不处理 re-export（@TODO 讲讲什么什么叫命名导出， re-export是什么）
 *  - 不引入 Terser，直接在 AST 层面移除 unused 代码（合并了步骤 4-5）
 *  - 不处理 sideEffects 标记 （@TODO 讲讲什么叫sideEffects标记）
 *
 * 运行方式：cd WebPack/mini-webpack && npm install && cd .. && node tree-shaking-demo.js
 */

// 复用 mini-webpack 的 babel 依赖
const parser = require("./mini-webpack/node_modules/@babel/parser");
const traverse = require("./mini-webpack/node_modules/@babel/traverse").default;
const generator = require("./mini-webpack/node_modules/@babel/generator").default;

// ─── 示例源码 ───────────────────────────────────────────────────────────────

const files = {
  "./src/math.js": `
export const add = (a, b) => a + b;
export const subtract = (a, b) => a - b;
export const multiply = (a, b) => a * b;
export const PI = 3.14159;
`,

  "./src/index.js": `
import { add, subtract } from './math';
console.log('add(1,2)=' + add(1, 2) + ', subtract(5,3)=' + subtract(5, 3));
`,
};

// ═══════════════════════════════════════════════════════════════════════════
// 步骤 1：收集 providedExports
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 的 HarmonyExportSpecifierDependency：
// parse 阶段遇到 export 声明就记录到 module.buildInfo.providedExports

function collectProvidedExports(source) {
  const ast = parser.parse(source, { sourceType: "module" });
  const exports = [];

  traverse(ast, {
    ExportNamedDeclaration({ node }) {
      if (node.declaration) {
        if (node.declaration.type === "VariableDeclaration") {
          // export const a = 1, b = 2;
          node.declaration.declarations.forEach((d) => exports.push(d.id.name));
        } else if (node.declaration.id) {
          // export function foo() {} / export class Bar {}
          exports.push(node.declaration.id.name);
        }
      }
      if (node.specifiers) {
        // export { a, b }
        node.specifiers.forEach((s) => {
          exports.push(s.exported.name || s.exported.value);
        });
      }
    },
  });

  return exports;
}

// ═══════════════════════════════════════════════════════════════════════════
// 步骤 2：收集 usedExports
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 的 HarmonyImportSpecifierDependency：
// 遇到 import { add } from './math' 就记录 math.js 的 usedExports 包含 'add'
//
// import * as xxx → 所有导出都被使用，标记 '*'

function collectUsedExports(allSources) {
  const usedMap = {}; // { 模块路径: Set<被使用的导出名> }

  for (const source of Object.values(allSources)) {
    const ast = parser.parse(source, { sourceType: "module" });

    traverse(ast, {
      ImportDeclaration({ node }) {
        let src = node.source.value;
        if (!src.endsWith(".js")) src += ".js";
        // 将相对路径统一为 ./src/ 前缀，与 providedMap 的 key 对齐
        if (!src.startsWith("./src/")) src = "./src/" + src.replace("./", "");

        if (!usedMap[src]) usedMap[src] = new Set();

        node.specifiers.forEach((spec) => {
          if (spec.type === "ImportSpecifier") {
            usedMap[src].add(spec.imported.name);
          } else if (spec.type === "ImportDefaultSpecifier") {
            usedMap[src].add("default");
          } else if (spec.type === "ImportNamespaceSpecifier") {
            usedMap[src].add("*");
          }
        });
      },
    });
  }

  return usedMap;
}

// ═══════════════════════════════════════════════════════════════════════════
// 步骤 3：标记 unused
// ═══════════════════════════════════════════════════════════════════════════
//
// 对应 webpack 的 FlagDependencyUsagePlugin：
// 遍历整个模块依赖图，为每个模块计算哪些导出被使用、哪些未被使用

function markUnusedExports(providedMap, usedMap) {
  const result = {};

  for (const [filePath, provided] of Object.entries(providedMap)) {
    const used = usedMap[filePath] || new Set();

    if (used.has("*")) {
      result[filePath] = { used: provided, unused: [] };
      continue;
    }

    result[filePath] = {
      used: provided.filter((e) => used.has(e)),
      unused: provided.filter((e) => !used.has(e)),
    };
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 步骤 4 + 5：移除 unused exports（合并了 webpack 的"去 export"和 Terser 的"删代码"）
// ═══════════════════════════════════════════════════════════════════════════
//
// webpack 真实做法：
//   1. unused 的 export const multiply = ... → 去掉 export，变成 const multiply = ...
//   2. 添加 /* unused harmony export multiply */ 注释
//   3. Terser 发现 multiply 是无引用局部变量 → 删除
//
// 本文件简化：直接删除整条声明，效果等价

function removeUnusedExports(source, unusedExports) {
  if (!unusedExports.length) return source;

  const ast = parser.parse(source, { sourceType: "module" });
  const unusedSet = new Set(unusedExports);

  traverse(ast, {
    ExportNamedDeclaration(nodePath) {
      const { node } = nodePath;

      // export const a = ..., b = ...;
      if (node.declaration?.type === "VariableDeclaration") {
        const kept = node.declaration.declarations.filter((d) => !unusedSet.has(d.id.name));
        const removed = node.declaration.declarations.filter((d) => unusedSet.has(d.id.name));

        if (removed.length === 0) return;

        const names = removed.map((d) => d.id.name).join(", ");
        nodePath.addComment("leading", ` unused harmony export: ${names} `);

        if (kept.length === 0) {
          nodePath.remove();
        } else {
          node.declaration.declarations = kept;
        }
      }

      // export function foo() {} / export class Foo {}
      if (node.declaration?.id && unusedSet.has(node.declaration.id.name)) {
        nodePath.addComment("leading", ` unused harmony export: ${node.declaration.id.name} `);
        nodePath.remove();
      }
    },
  });

  return generator(ast, { comments: true }).code;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESM → CJS 转换（简化版，让产物能在 Node.js 跑）
// ═══════════════════════════════════════════════════════════════════════════
//
// webpack 的真正做法是用 require.defineProperty (即 __webpack_require__.d)
// 实现 live binding（getter 方式），见 esm-loader-demo.js。
// 这里简化为直接赋值，足以验证 tree shaking 效果。

function esmToCjs(source) {
  const ast = parser.parse(source, { sourceType: "module" });
  const types = require("./mini-webpack/node_modules/@babel/types");

  traverse(ast, {
    ImportDeclaration(nodePath) {
      let src = nodePath.node.source.value;
      if (!src.endsWith(".js")) src += ".js";
      if (!src.startsWith("./src/")) src = "./src/" + src.replace("./", "");

      const specifiers = nodePath.node.specifiers;
      if (!specifiers.length) {
        // import './sideEffects' → require('./sideEffects')
        nodePath.replaceWith(
          types.expressionStatement(
            types.callExpression(types.identifier("require"), [types.stringLiteral(src)])
          )
        );
        return;
      }

      // import { add, subtract } from './math'
      // → const { add, subtract } = require('./math.js')
      const properties = specifiers
        .map((s) => {
          if (s.type === "ImportSpecifier") {
            return types.objectProperty(
              types.identifier(s.imported.name),
              types.identifier(s.local.name),
              false,
              s.imported.name === s.local.name // shorthand
            );
          }
          if (s.type === "ImportDefaultSpecifier") {
            return types.objectProperty(
              types.identifier("default"),
              types.identifier(s.local.name)
            );
          }
          return null;
        })
        .filter(Boolean);

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

  return generator(ast, { comments: true }).code;
}

// ═══════════════════════════════════════════════════════════════════════════
// 生成 bundle（与 mini-webpack 的 getSource 结构一致）
// ═══════════════════════════════════════════════════════════════════════════

function generateBundle(processedModules, entryId) {
  return `(() => {
  var modules = {${Object.entries(processedModules)
    .map(
      ([id, code]) =>
        `\n    "${id}": (module, exports, require) => {\n${code
          .split("\n")
          .map((l) => "      " + l)
          .join("\n")}\n    }`
    )
    .join(",")}
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

console.log("=== Tree Shaking 演示 ===\n");

// 步骤 1
console.log("【步骤 1】收集 providedExports\n");
const providedMap = {};
for (const [fp, src] of Object.entries(files)) {
  const provided = collectProvidedExports(src);
  if (provided.length) {
    providedMap[fp] = provided;
    console.log(`  ${fp} → [${provided.join(", ")}]`);
  }
}

// 步骤 2
console.log("\n【步骤 2】收集 usedExports\n");
const usedMap = collectUsedExports(files);
for (const [fp, used] of Object.entries(usedMap)) {
  console.log(`  ${fp} → [${[...used].join(", ")}]`);
}

// 步骤 3
console.log("\n【步骤 3】标记 unused\n");
const markResult = markUnusedExports(providedMap, usedMap);
for (const [fp, { used, unused }] of Object.entries(markResult)) {
  console.log(`  ${fp}:`);
  console.log(`    used:   [${used.join(", ")}]`);
  console.log(`    unused: [${unused.join(", ")}]${unused.length ? "  ← 将被移除" : ""}`);
}

// 步骤 4+5
console.log("\n【步骤 4+5】移除 unused → 转换 ESM → CJS\n");
const processed = {};
for (const [fp, src] of Object.entries(files)) {
  const unused = markResult[fp]?.unused || [];
  const shaken = removeUnusedExports(src, unused);
  processed[fp] = esmToCjs(shaken);
  console.log(`  ── ${fp} ──`);
  console.log(processed[fp]);
  console.log();
}

// 生成 bundle 并执行
console.log("【生成 bundle 并执行】\n");
const bundle = generateBundle(processed, "./src/index.js");
console.log(bundle);
console.log("\n--- 执行结果 ---\n");
eval(bundle);

console.log("\n--- 对比 ---");
console.log("原始导出：add, subtract, multiply, PI");
console.log("实际使用：add, subtract");
console.log("被移除：  multiply, PI");
console.log("\n真实 webpack 中还有 sideEffects 配置：");
console.log('  "sideEffects": false → 所有导出 unused 的模块整个跳过不打包');
console.log('  "sideEffects": ["*.css"] → CSS 有副作用（import 即生效），不跳过');
