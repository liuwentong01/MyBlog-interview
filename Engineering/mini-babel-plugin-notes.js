/**
 * Babel 插件 — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  Babel 的核心架构
 * ═══════════════════════════════════════════════════════
 *
 * Babel 处理流程（三大阶段）：
 *
 *   1. Parse（解析）：@babel/parser
 *      源代码 → AST（抽象语法树）
 *      词法分析（Tokenize）：代码 → Token 流
 *      语法分析（Parse）：Token → AST
 *
 *   2. Transform（转换）：@babel/traverse
 *      遍历 AST → 插件修改节点 → 新 AST
 *      用 Visitor 模式：每种节点类型注册 enter/exit 回调
 *
 *   3. Generate（生成）：@babel/generator
 *      AST → 新代码字符串（+ source map）
 *
 * ═══════════════════════════════════════════════════════
 *  AST 节点类型（ESTree / Babel AST）
 * ═══════════════════════════════════════════════════════
 *
 * 常见节点：
 *   Program             — 根节点
 *   VariableDeclaration  — var/let/const 声明
 *   FunctionDeclaration  — function 声明
 *   ArrowFunctionExpression — 箭头函数
 *   CallExpression       — 函数调用 fn()
 *   MemberExpression     — 成员访问 obj.prop
 *   BinaryExpression     — 二元运算 a + b
 *   IfStatement          — if 语句
 *   ImportDeclaration    — import 语句
 *   ExportDefaultDeclaration — export default
 *
 * 工具：https://astexplorer.net/ 在线查看 AST
 *
 * ═══════════════════════════════════════════════════════
 *  Babel 插件结构
 * ═══════════════════════════════════════════════════════
 *
 * 一个插件就是一个函数，返回 visitor 对象：
 *
 *   module.exports = function(babel) {
 *     const { types: t } = babel;  // @babel/types 工具
 *     return {
 *       visitor: {
 *         // 遇到箭头函数时执行
 *         ArrowFunctionExpression(path) {
 *           // path.node — 当前 AST 节点
 *           // path.parent — 父节点
 *           // path.replaceWith(newNode) — 替换节点
 *           // path.remove() — 删除节点
 *           // path.insertBefore(newNode) — 在前面插入
 *         }
 *       }
 *     };
 *   };
 *
 * ═══════════════════════════════════════════════════════
 *  经典插件示例
 * ═══════════════════════════════════════════════════════
 *
 * 【示例 1：箭头函数转普通函数】
 *
 *   转换前：const add = (a, b) => a + b;
 *   转换后：const add = function(a, b) { return a + b; };
 *
 *   visitor: {
 *     ArrowFunctionExpression(path) {
 *       const { params, body } = path.node;
 *       // 如果 body 不是 BlockStatement（简写形式），包一层 return
 *       const newBody = t.isBlockStatement(body)
 *         ? body
 *         : t.blockStatement([t.returnStatement(body)]);
 *       path.replaceWith(
 *         t.functionExpression(null, params, newBody)
 *       );
 *     }
 *   }
 *
 * 【示例 2：可选链转换】
 *
 *   转换前：user?.address?.city
 *   转换后：user == null ? void 0 : user.address == null ? void 0 : user.address.city
 *
 *   visitor: {
 *     OptionalMemberExpression(path) {
 *       // 递归展开 ?. 为三元表达式
 *       // 需要处理 obj?.method() 和 obj?.prop 两种情况
 *     }
 *   }
 *
 * 【示例 3：自动埋点注入】
 *
 *   转换前：function handleClick() { doSomething(); }
 *   转换后：function handleClick() { tracker.send('handleClick'); doSomething(); }
 *
 *   visitor: {
 *     FunctionDeclaration(path) {
 *       const name = path.node.id.name;
 *       if (name.startsWith("handle")) {
 *         const trackCall = t.expressionStatement(
 *           t.callExpression(
 *             t.memberExpression(t.identifier("tracker"), t.identifier("send")),
 *             [t.stringLiteral(name)]
 *           )
 *         );
 *         path.get("body").unshiftContainer("body", trackCall);
 *       }
 *     }
 *   }
 *
 * 【示例 4：console.log 自动添加文件名和行号】
 *
 *   转换前：console.log("hello")
 *   转换后：console.log("[App.jsx:10]", "hello")
 *
 *   visitor: {
 *     CallExpression(path) {
 *       if (path.node.callee matches console.log) {
 *         const { line } = path.node.loc.start;
 *         path.node.arguments.unshift(
 *           t.stringLiteral(`[${filename}:${line}]`)
 *         );
 *       }
 *     }
 *   }
 *
 * ═══════════════════════════════════════════════════════
 *  @babel/types — AST 构造工具
 * ═══════════════════════════════════════════════════════
 *
 * 常用方法：
 *   t.identifier("name")            → Identifier 节点
 *   t.stringLiteral("hello")        → StringLiteral 节点
 *   t.numericLiteral(42)            → NumericLiteral 节点
 *   t.callExpression(callee, args)  → CallExpression 节点
 *   t.memberExpression(obj, prop)   → MemberExpression 节点
 *   t.functionExpression(id, params, body) → FunctionExpression
 *   t.blockStatement(body)          → BlockStatement
 *   t.returnStatement(argument)     → ReturnStatement
 *
 * 判断方法：
 *   t.isIdentifier(node)
 *   t.isCallExpression(node)
 *   t.isArrowFunctionExpression(node)
 *
 * ═══════════════════════════════════════════════════════
 *  Path 对象 — 节点的导航和操作
 * ═══════════════════════════════════════════════════════
 *
 * path 不等于 node！path 是对 node 的包装，提供上下文信息：
 *
 *   path.node           — 当前节点
 *   path.parent         — 父节点
 *   path.parentPath     — 父 path
 *   path.scope          — 当前作用域
 *
 * 操作方法：
 *   path.replaceWith(newNode)     — 替换
 *   path.replaceWithMultiple([])  — 替换为多个节点
 *   path.remove()                 — 删除
 *   path.insertBefore(node)       — 前面插入
 *   path.insertAfter(node)        — 后面插入
 *   path.get("body")              — 获取子路径
 *   path.traverse(visitor)        — 子树遍历
 *   path.skip()                   — 跳过子节点遍历
 *   path.stop()                   — 停止整个遍历
 *
 * ═══════════════════════════════════════════════════════
 *  Scope — 作用域分析
 * ═══════════════════════════════════════════════════════
 *
 * Babel 自动维护作用域信息：
 *   path.scope.hasBinding("name")       — 变量是否在当前作用域声明
 *   path.scope.getBinding("name")       — 获取绑定信息
 *   path.scope.generateUidIdentifier()  — 生成唯一标识符（避免命名冲突）
 *   path.scope.rename("old", "new")     — 安全重命名变量
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. Babel 三阶段：Parse(代码→AST) → Transform(遍历修改) → Generate(AST→代码)
 * 2. 插件 = 返回 visitor 对象的函数，visitor key 是 AST 节点类型
 * 3. path 不是 node：path 提供上下文（parent/scope）和操作方法（replace/remove）
 * 4. @babel/types 用于创建和判断 AST 节点
 * 5. Scope 分析确保重命名、变量操作不会冲突
 * 6. 经典插件场景：语法降级、自动埋点、代码检查、性能优化
 * 7. 所有编译工具（ESLint/PostCSS/TypeScript）都遵循相同的 AST visitor 模式
 */

console.log("=== Babel 插件 — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "三阶段流程", key: "Parse(@babel/parser) → Transform(@babel/traverse) → Generate(@babel/generator)" },
  { name: "插件结构", key: "function(babel) → { visitor: { NodeType(path) {} } }" },
  { name: "@babel/types", key: "t.identifier() / t.callExpression() / t.isXxx() — 创建和判断 AST 节点" },
  { name: "Path 对象", key: "node 的包装：parent/scope/replaceWith/remove/insertBefore" },
  { name: "Scope 分析", key: "hasBinding/getBinding/generateUid/rename — 安全变量操作" },
  { name: "经典场景", key: "箭头函数转换 / 可选链降级 / 自动埋点 / console 增强" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
