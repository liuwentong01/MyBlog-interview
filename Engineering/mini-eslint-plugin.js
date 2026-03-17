/**
 * Mini ESLint 规则 / 插件实现
 *
 * ═══════════════════════════════════════════════════════
 *  ESLint 的核心原理
 * ═══════════════════════════════════════════════════════
 *
 * ESLint 和 Babel 一样基于 AST，但目的不同：
 *   Babel：转换代码（AST → 修改 → 代码）
 *   ESLint：检查代码（AST → 遍历 → 报告问题）
 *
 * 一条 ESLint 规则的本质：
 *   1. 解析代码为 AST（ESLint 用 espree，兼容 ESTree 规范）
 *   2. 用 visitor 模式遍历 AST 节点
 *   3. 在特定节点上检查是否违规
 *   4. 违规则 context.report() 报告问题（可附带自动修复）
 *
 * 规则的结构：
 *   module.exports = {
 *     meta: { type, docs, fixable, schema },
 *     create(context) {
 *       return {
 *         NodeType(node) { ... }  // visitor
 *       };
 *     }
 *   };
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. 简化版 AST 解析器（识别关键模式）
 *  2. Linter 引擎（遍历 AST + 执行规则 + 收集报告）
 *  3. 规则 1：no-console（禁止 console.log）
 *  4. 规则 2：no-var（禁止 var，建议 let/const）
 *  5. 规则 3：eqeqeq（禁止 == / !=，要求 === / !==）
 *  6. 规则 4：no-unused-vars（简化版未使用变量检测）
 *  7. 自动修复（autofix）演示
 *
 * 运行方式：node Engineering/mini-eslint-plugin.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、简化版 AST 节点类型
// ═══════════════════════════════════════════════════════════════════════════
//
// 真实 ESLint 用 espree（基于 acorn）解析，输出 ESTree 规范的 AST。
// 这里我们用正则 + 简单解析模拟 AST 生成，重点在规则和 Linter 引擎。

/**
 * 简化版解析器
 * 将代码按行解析为 AST 节点数组
 * 真实实现用 espree/acorn，这里用模式匹配模拟
 */
function parse(code) {
  const lines = code.split("\n");
  const ast = { type: "Program", body: [], comments: [] };

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return;

    const lineNum = lineIndex + 1;

    // 检测 console.xxx()
    const consoleMatch = trimmed.match(/console\.(log|warn|error|info|debug)\s*\(/);
    if (consoleMatch) {
      ast.body.push({
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: {
            type: "MemberExpression",
            object: { type: "Identifier", name: "console" },
            property: { type: "Identifier", name: consoleMatch[1] },
          },
        },
        loc: { start: { line: lineNum, column: line.indexOf("console") } },
        raw: trimmed,
      });
    }

    // 检测 var 声明
    const varMatch = trimmed.match(/^var\s+(\w+)/);
    if (varMatch) {
      ast.body.push({
        type: "VariableDeclaration",
        kind: "var",
        declarations: [{ type: "VariableDeclarator", id: { name: varMatch[1] } }],
        loc: { start: { line: lineNum, column: line.indexOf("var") } },
        raw: trimmed,
      });
    }

    // 检测 let/const 声明
    const letConstMatch = trimmed.match(/^(let|const)\s+(\w+)/);
    if (letConstMatch) {
      ast.body.push({
        type: "VariableDeclaration",
        kind: letConstMatch[1],
        declarations: [{ type: "VariableDeclarator", id: { name: letConstMatch[2] } }],
        loc: { start: { line: lineNum, column: 0 } },
        raw: trimmed,
      });
    }

    // 检测 == 或 != （不是 === / !==）
    const eqMatch = trimmed.match(/[^=!](==)[^=]|[^=!](!=)[^=]/);
    if (eqMatch) {
      const operator = eqMatch[1] || eqMatch[2];
      ast.body.push({
        type: "BinaryExpression",
        operator: operator,
        loc: { start: { line: lineNum, column: trimmed.indexOf(operator) } },
        raw: trimmed,
      });
    }
  });

  return ast;
}

/**
 * 收集代码中所有标识符的使用情况（简化版）
 * 用于 no-unused-vars 规则
 */
function collectIdentifiers(code) {
  const declarations = new Map(); // name → { line, kind }
  const usages = new Set();

  const lines = code.split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();

    // 收集声明
    const declMatch = trimmed.match(/^(var|let|const)\s+(\w+)/);
    if (declMatch) {
      declarations.set(declMatch[2], { line: i + 1, kind: declMatch[1] });
    }

    // 收集使用（排除声明本身的左侧）
    // 简化：找所有标识符出现
    const identifiers = trimmed.match(/\b[a-zA-Z_]\w*\b/g) || [];
    identifiers.forEach((id) => {
      if (!["var", "let", "const", "function", "if", "else", "return", "console", "log", "true", "false"].includes(id)) {
        // 如果不是在声明语句的左侧
        if (!trimmed.match(new RegExp(`^(var|let|const)\\s+${id}\\b`))) {
          usages.add(id);
        }
      }
    });
  });

  return { declarations, usages };
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、Linter 引擎
// ═══════════════════════════════════════════════════════════════════════════
//
// Linter 的职责：
//   1. 解析代码为 AST
//   2. 遍历 AST，对每个节点调用匹配的规则 visitor
//   3. 规则通过 context.report() 报告问题
//   4. 收集所有问题，按行号排序输出

class Linter {
  constructor() {
    this.rules = new Map();  // 规则注册表
  }

  /**
   * 注册规则
   * @param {string} name - 规则名
   * @param {Object} rule - 规则对象 { meta, create }
   */
  defineRule(name, rule) {
    this.rules.set(name, rule);
  }

  /**
   * 检查代码
   * @param {string} code - 源代码
   * @param {Object} config - 规则配置 { rules: { "no-console": "error" } }
   * @returns {Array} 问题列表
   */
  verify(code, config = {}) {
    const ast = parse(code);
    const messages = [];
    const fixes = [];

    // 对每条启用的规则，创建 context 并执行
    for (const [ruleName, severity] of Object.entries(config.rules || {})) {
      if (severity === "off") continue;

      const rule = this.rules.get(ruleName);
      if (!rule) continue;

      // context 对象：规则通过它报告问题
      const context = {
        report({ node, message, fix, loc }) {
          const location = loc || (node && node.loc) || { start: { line: 0, column: 0 } };
          const msg = {
            ruleId: ruleName,
            severity: severity === "error" ? 2 : 1,
            message,
            line: location.start.line,
            column: location.start.column,
          };
          messages.push(msg);
          if (fix) {
            fixes.push({ ruleId: ruleName, line: location.start.line, fix });
          }
        },
        getSourceCode() {
          return { text: code, ast };
        },
      };

      // 执行规则的 create，得到 visitor 对象
      const visitor = rule.create(context);

      // 遍历 AST，调用匹配的 visitor
      for (const node of ast.body) {
        if (visitor[node.type]) {
          visitor[node.type](node);
        }
        // 也检查子节点类型（如 CallExpression）
        if (node.expression && visitor[node.expression.type]) {
          visitor[node.expression.type](node.expression, node);
        }
      }
    }

    // 按行号排序
    messages.sort((a, b) => a.line - b.line || a.column - b.column);

    return { messages, fixes };
  }

  /**
   * 自动修复
   * 应用所有 fix 函数，生成修复后的代码
   */
  verifyAndFix(code, config) {
    const { messages, fixes } = this.verify(code, config);
    if (fixes.length === 0) return { output: code, messages, fixed: false };

    let lines = code.split("\n");
    // 从后往前应用修复（避免行号偏移）
    fixes.sort((a, b) => b.line - a.line);
    for (const { line, fix } of fixes) {
      const result = fix(lines[line - 1]);
      if (result !== undefined) {
        lines[line - 1] = result;
      }
    }

    return { output: lines.join("\n"), messages, fixed: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、规则实现
// ═══════════════════════════════════════════════════════════════════════════

// ── 规则 1：no-console ──
// 禁止使用 console.log/warn/error 等
// 这是最经典的 ESLint 规则示例

const noConsole = {
  meta: {
    type: "suggestion",
    docs: { description: "禁止使用 console" },
    fixable: "code",  // 支持自动修复
  },
  create(context) {
    return {
      // visitor: 当遇到 CallExpression 节点时执行
      CallExpression(node, parent) {
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "console"
        ) {
          context.report({
            node: parent || node,
            message: `不允许使用 console.${node.callee.property.name}`,
            // 自动修复：删除整行（或替换为注释）
            fix(line) {
              return "// " + line + "  // [auto-fixed: no-console]";
            },
          });
        }
      },
    };
  },
};

// ── 规则 2：no-var ──
// 禁止使用 var，建议用 let 或 const

const noVar = {
  meta: {
    type: "suggestion",
    docs: { description: "禁止使用 var 声明" },
    fixable: "code",
  },
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.kind === "var") {
          context.report({
            node,
            message: "不要使用 var，请使用 let 或 const",
            fix(line) {
              return line.replace(/\bvar\b/, "let");
            },
          });
        }
      },
    };
  },
};

// ── 规则 3：eqeqeq ──
// 要求使用 === 和 !== 而非 == 和 !=

const eqeqeq = {
  meta: {
    type: "problem",
    docs: { description: "要求使用 === 和 !==" },
    fixable: "code",
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator === "==" || node.operator === "!=") {
          const preferred = node.operator === "==" ? "===" : "!==";
          context.report({
            node,
            message: `使用 '${preferred}' 代替 '${node.operator}'`,
            fix(line) {
              return line.replace(
                node.operator === "==" ? /([^=!])={2}([^=])/ : /([^=!])!={1}([^=])/,
                `$1${preferred}$2`
              );
            },
          });
        }
      },
    };
  },
};

// ── 规则 4：no-unused-vars（简化版）──
// 检测声明了但未使用的变量
// 真实实现需要作用域分析（scope analysis），这里简化为全局扫描

const noUnusedVars = {
  meta: {
    type: "problem",
    docs: { description: "禁止未使用的变量" },
  },
  create(context) {
    // 这个规则比较特殊，需要扫描整个文件
    // 真实 ESLint 中用 Program:exit 事件（遍历完所有节点后执行）
    return {
      // 用 Program 类型模拟 "遍历完成后" 的检查
      VariableDeclaration(node) {
        const code = context.getSourceCode().text;
        const { declarations, usages } = collectIdentifiers(code);

        for (const [name, info] of declarations) {
          if (!usages.has(name)) {
            context.report({
              loc: { start: { line: info.line, column: 0 } },
              message: `'${name}' 已声明但未使用`,
            });
          }
        }
      },
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 四、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini ESLint 规则/插件演示 ===\n");

const linter = new Linter();
linter.defineRule("no-console", noConsole);
linter.defineRule("no-var", noVar);
linter.defineRule("eqeqeq", eqeqeq);
linter.defineRule("no-unused-vars", noUnusedVars);

// ── 测试 1：基础规则检查 ──

console.log("【测试 1】基础规则检查\n");

const testCode1 = `
var name = "hello"
let age = 25
console.log(name)
if (age == 25) {
  console.warn("young")
}
var unused = 123
`.trim();

console.log("  源代码:");
testCode1.split("\n").forEach((line, i) => console.log(`    ${i + 1} | ${line}`));

const config1 = {
  rules: {
    "no-console": "error",
    "no-var": "warn",
    "eqeqeq": "error",
  },
};

const result1 = linter.verify(testCode1, config1);
console.log("\n  检查结果:");
result1.messages.forEach((msg) => {
  const icon = msg.severity === 2 ? "error" : "warn ";
  console.log(`    ${msg.line}:${msg.column}  ${icon}  ${msg.message}  (${msg.ruleId})`);
});

// ── 测试 2：自动修复 ──

console.log("\n\n【测试 2】自动修复（autofix）\n");

const testCode2 = `
var count = 0
console.log(count)
if (count == 0) {
  var result = "zero"
}
`.trim();

console.log("  修复前:");
testCode2.split("\n").forEach((line, i) => console.log(`    ${i + 1} | ${line}`));

const config2 = {
  rules: {
    "no-console": "error",
    "no-var": "warn",
    "eqeqeq": "error",
  },
};

const fixResult = linter.verifyAndFix(testCode2, config2);
console.log("\n  修复后:");
fixResult.output.split("\n").forEach((line, i) => console.log(`    ${i + 1} | ${line}`));
console.log(`\n  共修复 ${fixResult.fixes ? fixResult.messages.length : 0} 个问题`);

// ── 测试 3：no-unused-vars ──

console.log("\n\n【测试 3】no-unused-vars（未使用变量检测）\n");

const testCode3 = `
let used = 1
let unused = 2
let alsoUnused = 3
console.log(used)
`.trim();

console.log("  源代码:");
testCode3.split("\n").forEach((line, i) => console.log(`    ${i + 1} | ${line}`));

const result3 = linter.verify(testCode3, { rules: { "no-unused-vars": "warn" } });
console.log("\n  检查结果:");
// 去重（因为简化实现可能重复报告）
const seen = new Set();
result3.messages.forEach((msg) => {
  const key = `${msg.line}:${msg.message}`;
  if (!seen.has(key)) {
    seen.add(key);
    console.log(`    ${msg.line}:${msg.column}  warn   ${msg.message}  (${msg.ruleId})`);
  }
});

// ── 测试 4：规则配置 ──

console.log("\n\n【测试 4】规则配置（off/warn/error）\n");

const testCode4 = `console.log("test")`;

console.log("  同一行代码 console.log('test'):");
["off", "warn", "error"].forEach((level) => {
  const r = linter.verify(testCode4, { rules: { "no-console": level } });
  console.log(`    no-console: "${level}" → ${r.messages.length} 个问题${r.messages.length ? ` (severity: ${r.messages[0].severity})` : ""}`);
});

console.log("\n\n=== 面试要点 ===");
console.log("1. ESLint 规则 = AST visitor 模式：遍历节点 → 检查模式 → context.report()");
console.log("2. 规则结构：meta（元信息）+ create(context)（返回 visitor 对象）");
console.log("3. visitor 的 key 是 AST 节点类型：CallExpression / VariableDeclaration / BinaryExpression");
console.log("4. 自动修复：report 中提供 fix 函数，ESLint 收集后统一应用（从后往前避免偏移）");
console.log("5. 规则配置三级：off(0) / warn(1) / error(2)");
console.log("6. 真实 ESLint 还有 scope analysis（作用域分析）用于 no-unused-vars 等复杂规则");
console.log("7. ESLint 插件 = 一组规则 + 可选的 processor/config，通过 npm 包分发");
