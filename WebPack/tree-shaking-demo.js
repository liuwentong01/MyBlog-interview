/**
 * Tree Shaking 实现演示
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Q&A：阅读本文件时产生的疑问与解答
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Q1: 为什么 CommonJS 做不了 Tree Shaking？
 *     （我理解可以通过 require 静态分析引用了哪些模块呀，
 *       math[dynamicKey]() 的 dynamicKey 为什么是动态的？）
 *
 *   你说的"可以静态分析 require 引用了哪些模块"是对的——webpack 确实能分析出
 *   require('./math') 依赖了 math 模块。但 Tree Shaking 要解决的不是"依赖了哪个模块"，
 *   而是"用了模块里的哪些导出"。这是两个不同层面的问题：
 *
 *   【模块级别】require('./math') → 知道依赖 math 模块 ✓（CJS 能做到）
 *   【导出级别】到底用了 math.add 还是 math.multiply？ → CJS 做不到 ✗
 *
 *   原因 1：require() 返回的是一个普通 JS 对象，怎么访问属性是运行时行为
 *
 *     const math = require('./math');
 *     // math 就是普通对象 { add: fn, subtract: fn, multiply: fn }
 *     // 接下来怎么用这个对象，编译期无法完全确定：
 *     math.add(1, 2);          // 静态分析勉强能看出用了 add
 *     math['add'](1, 2);       // 字符串字面量，也勉强能分析
 *     math[key](1, 2);         // key 是变量 → 编译期不知道 key 的值 → 无法分析
 *                               // （这就是 dynamicKey 为什么是"动态的"——
 *                               //   key 可以是任何运行时才确定的字符串，
 *                               //   比如 key = userInput ? 'add' : 'multiply'）
 *     Object.keys(math);       // 遍历了所有属性 → 全都算"用了"
 *     doSomething(math);       // 整个对象传走了 → 不知道外部会访问什么属性
 *
 *   原因 2：require() 可以出现在任意位置（条件、循环、函数体内）
 *
 *     if (process.env.NODE_ENV === 'production') {
 *       const math = require('./math');   // 运行时才知道会不会执行
 *     }
 *     const modules = ['./math', './string'];
 *     modules.forEach(m => require(m));   // 动态路径，编译期根本不知道加载谁
 *
 *   原因 3：module.exports 可以在运行时被任意修改
 *
 *     // math.js
 *     module.exports.add = (a, b) => a + b;
 *     if (featureFlag) {
 *       module.exports.multiply = (a, b) => a * b;  // 条件性导出
 *     }
 *     setTimeout(() => { module.exports.late = () => {}; }, 100);  // 异步追加
 *     // → 编译期根本不知道 exports 上最终会有哪些属性
 *
 *   而 ES Module 的语法设计从根源上杜绝了这些问题：
 *
 *     import { add } from './math';
 *     // 1. import 必须在模块顶层（不能在 if/for/function 里）→ 不存在条件导入
 *     // 2. 导入的名称必须是静态字符串字面量（不能是变量）→ 不存在动态 key
 *     // 3. 导入的绑定是只读的（不能 add = xxx）→ 引用关系确定
 *     // 4. export 声明也必须在顶层，导出列表在编译期 100% 确定
 *
 *   总结：CJS 能分析"依赖了哪些模块"，但无法可靠地分析"用了模块的哪些导出"。
 *   Tree Shaking 需要的恰恰是后者。ESM 的静态语法结构让这成为可能。
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Q2: 什么叫命名导出（Named Export）？re-export 是什么？
 *
 *   ① 命名导出（Named Export）：在当前模块中定义并导出一个具名绑定
 *      export const add = (a, b) => a + b;       // 声明式
 *      export function subtract(a, b) { ... }     // 声明式
 *      const PI = 3.14;
 *      export { PI };                              // 列表式（导出已有变量）
 *      export { PI as CirclePI };                  // 带重命名
 *
 *   ② 默认导出（Default Export）：每个模块只能有一个
 *      export default function() { ... }
 *      export default 42;
 *      // 本质上是导出了一个名为 "default" 的绑定
 *
 *   ③ re-export（重新导出）：从别的模块导入后直接导出，自己不使用
 *      export { add } from './math';              // 从 math 拿 add 直接导出
 *      export { add as plus } from './math';      // 重命名后导出
 *      export * from './math';                    // 把 math 的所有命名导出全部转发
 *      export { default } from './math';          // 转发默认导出
 *
 *      re-export 常见于"桶文件"（barrel file），比如：
 *        // utils/index.js（入口汇总文件）
 *        export { add, subtract } from './math';
 *        export { format } from './string';
 *        export { debounce } from './function';
 *        // 消费方只需 import { add, format } from './utils' 即可
 *
 *      对 Tree Shaking 来说，re-export 需要追踪"转发链"：
 *        index.js → import { add } from './utils'
 *        utils.js → export { add } from './math'  （re-export，自己不用 add）
 *        math.js  → export const add = ...         （真正的定义）
 *        webpack 需要顺着链路判断 math.js 的 add 最终是否被使用
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Q3: 什么叫 sideEffects 标记？
 *
 *   Tree Shaking 只能移除"未被使用的导出"，但有些代码没有导出也会产生影响：
 *
 *     // polyfill.js
 *     Array.prototype.myFlat = function() { ... };  // 修改了全局原型！
 *     // 没有 export 任何东西，但 import './polyfill' 会改变全局行为
 *
 *     // style.css（被 css-loader 处理后）
 *     import './style.css';  // 没有导出，但 import 本身就是"副作用"——注入样式
 *
 *   这种"import 了就会产生效果，跟你用不用它的导出无关"的行为叫做副作用（side effect）。
 *
 *   问题来了：如果一个模块的所有导出都 unused，webpack 能不能跳过整个模块不打包？
 *   不一定——因为这个模块可能有副作用（比如上面的 polyfill）。
 *
 *   于是 webpack 提供了 package.json 中的 sideEffects 字段，让开发者主动声明：
 *
 *     // package.json
 *     {
 *       "sideEffects": false
 *       // 含义："我这个包里所有模块都没有副作用"
 *       // → 如果某个模块的导出全部 unused，webpack 可以放心地整个跳过不打包
 *     }
 *
 *     {
 *       "sideEffects": ["*.css", "./src/polyfill.js"]
 *       // 含义："除了这些文件有副作用，其他文件都没有"
 *       // → CSS 文件和 polyfill.js 即使导出 unused 也不会被跳过
 *       // → 其余文件如果导出全部 unused，可以安全跳过
 *     }
 *
 *   实际效果对比（假设 index.js 中 import { add } from 'lodash-es'）：
 *     没有 sideEffects 声明 → webpack 保守处理，lodash-es 所有模块都打包
 *     "sideEffects": false  → webpack 只打包 add 相关的模块，其余全部跳过
 *     这就是为什么 lodash-es 比 lodash 小得多的原因之一
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Q4: providedMap 和 usedMap 为什么不一起生成？
 *     在一次 traverse 中同时处理是否效率更好？真实 webpack 怎么处理的？
 *
 *   直觉上一次遍历同时收集 export 和 import 更"高效"，但实际上做不到，
 *   因为它们的数据流方向不同：
 *
 *     providedExports：分析的是"自己"的 export 声明 → 结果挂在自己身上
 *     usedExports：分析的是"别人"对自己的 import 声明 → 结果要挂在被 别人 的模块身上
 *
 *   举例：遍历 index.js 时发现 import { add } from './math'
 *     → 这条信息不是 index.js 的 providedExports，而是 math.js 的 usedExports
 *     → 但此时 math.js 可能还没被遍历过，你甚至不知道 math.js 存不存在 add 这个导出
 *
 *   所以必须分两步：
 *     1. 先遍历所有模块，各自收集自己的 providedExports（每个模块独立完成）
 *     2. 再遍历所有模块，看它们 import 了谁的什么 → 汇总成被导入模块的 usedExports
 *
 *   webpack 真实场景中也是这样的两阶段设计：
 *     阶段 1（build 阶段）：每个模块 parse 时通过 HarmonyExportSpecifierDependency 记录自己的 exports
 *     阶段 2（seal 阶段）：FlagDependencyUsagePlugin 遍历整个 ModuleGraph，
 *       从消费方的 HarmonyImportSpecifierDependency 反向标记每个模块的 usedExports
 *
 *   放在 seal 阶段而不是 build 阶段，是因为 seal 时整个依赖图已经完整构建好了，
 *   才能做全局的使用分析。build 阶段模块还在陆续发现中，信息不完整。
 *
 *   另外，真实 webpack 中 usedExports 的分析远比这里复杂——它需要处理：
 *     - re-export 链路追踪（A re-export B 的 add → 要追到 B 去标记）
 *     - import * as xxx 然后 xxx.add（需要分析 xxx 的属性访问）
 *     - 嵌套的 export * from（传递性导出）
 *   这些都需要【完整的模块依赖图】才能分析，单次遍历根本做不到。
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Q5: 为什么要把 ESM 转成 CJS？浏览器不是已经支持 ES Module 了吗？
 *
 *   浏览器确实原生支持 <script type="module"> + import/export，但 webpack 产物
 *   不是直接丢给浏览器去做模块解析的——webpack 产出的是一个自包含的 bundle。
 *
 *   webpack 的工作模式是：
 *     1. 把所有模块的代码包进一个大的 IIFE（立即执行函数）
 *     2. 用自己实现的 __webpack_require__ 来管理模块加载（见下面的 generateBundle）
 *     3. 每个模块变成 modules 对象里的一个函数 (module, exports, require) => { ... }
 *     4. 浏览器执行的是这个 bundle.js，不需要知道原始的 import/export
 *
 *   如果模块代码里还保留着 import/export 语法，塞进函数体里会报语法错误：
 *     modules["math.js"] = (module, exports, require) => {
 *       import { add } from './math';   // ← SyntaxError! import 只能在模块顶层
 *     }
 *
 *   所以必须把 ESM 语法转成函数体内合法的代码：
 *     import { add } from './math'  →  const { add } = require('./math.js')
 *     export const add = ...        →  const add = ...; exports.add = add;
 *
 *   这不是"ESM 退化成 CJS"，而是 webpack 的模块封装机制要求的转换。
 *   webpack 产物中的 require/exports 其实是 __webpack_require__ / module.exports，
 *   跟 Node.js 的 CommonJS 长得像但本质上是 webpack 自己的运行时。
 *
 *   补充：webpack 5 也支持输出真正的 ESM 格式（experiments.outputModule: true），
 *   这时产物会用 import/export 语法，浏览器以 <script type="module"> 加载。
 *   但这是实验性功能，主流方式仍然是包一层运行时。
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Q6: 真实场景也是通过 eval 来执行的吗？
 *
 *   不是。这里用 eval 纯粹是为了在演示脚本里验证 bundle 能跑通。
 *
 *   真实 webpack 的流程是：
 *     1. webpack 把 bundle 代码写入文件（如 dist/main.js）
 *     2. 浏览器通过 <script src="dist/main.js"> 加载并执行
 *     3. bundle 本身是一个 IIFE，浏览器的 JS 引擎直接执行，不需要 eval
 *
 *   eval 在前端工程中通常是要避免的（CSP 安全策略可能禁止、无法被引擎优化、
 *   调试困难），webpack 自身也不用 eval 来执行 bundle。
 *
 *   不过 webpack 的 devtool 配置中有一个 'eval' 选项：
 *     devtool: 'eval'
 *     → 开发模式下，每个模块的代码用 eval() 包裹执行
 *     → 目的是给每个模块加上 //# sourceURL=xxx 方便调试定位到原始模块
 *     → 这是开发时的调试辅助，不是生产环境的执行方式
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  以下是原文档
 * ═══════════════════════════════════════════════════════════════════════════
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
 *  - 只处理命名导出（export const / export function），不处理 re-export（见 Q2）
 *  - 不引入 Terser，直接在 AST 层面移除 unused 代码（合并了步骤 4-5）
 *  - 不处理 sideEffects 标记（见 Q3）
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
          types.expressionStatement(types.callExpression(types.identifier("require"), [types.stringLiteral(src)])),
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
              s.imported.name === s.local.name, // shorthand
            );
          }
          if (s.type === "ImportDefaultSpecifier") {
            return types.objectProperty(types.identifier("default"), types.identifier(s.local.name));
          }
          return null;
        })
        .filter(Boolean);

      nodePath.replaceWith(
        types.variableDeclaration("const", [
          types.variableDeclarator(
            types.objectPattern(properties),
            types.callExpression(types.identifier("require"), [types.stringLiteral(src)]),
          ),
        ]),
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
                types.identifier(name),
              ),
            ),
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
          .join("\n")}\n    }`,
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
// 见 Q4：为什么 providedMap 和 usedMap 不一起生成
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
  // 见 Q5：为什么要把 ESM 转成 CJS
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
eval(bundle); // 见 Q6：真实场景不用 eval

console.log("\n--- 对比 ---");
console.log("原始导出：add, subtract, multiply, PI");
console.log("实际使用：add, subtract");
console.log("被移除：  multiply, PI");
console.log("\n真实 webpack 中还有 sideEffects 配置：");
console.log('  "sideEffects": false → 所有导出 unused 的模块整个跳过不打包');
console.log('  "sideEffects": ["*.css"] → CSS 有副作用（import 即生效），不跳过');
