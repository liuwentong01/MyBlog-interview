/**
 * Mini PostCSS 插件实现
 *
 * ═══════════════════════════════════════════════════════
 *  PostCSS 的核心原理
 * ═══════════════════════════════════════════════════════
 *
 * PostCSS 和 Babel 的思路完全一致，只是处理的是 CSS：
 *   CSS 源码 → 解析为 AST → 插件遍历/修改 AST → 生成新 CSS
 *
 * PostCSS AST 的节点类型：
 *   Root        — 整个样式表
 *   AtRule      — @media, @keyframes 等
 *   Rule        — 选择器 { ... }
 *   Declaration — 属性: 值
 *   Comment     — 注释
 *
 * 插件的结构：
 *   module.exports = (opts) => ({
 *     postcssPlugin: 'plugin-name',
 *     Declaration(decl) { ... },  // visitor
 *     Rule(rule) { ... },
 *   });
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. CSS 解析器（CSS → AST）
 *  2. CSS 生成器（AST → CSS）
 *  3. PostCSS 引擎（加载插件 → 遍历 AST → 调用 visitor）
 *  4. 插件 1：px2rem（px 转 rem）
 *  5. 插件 2：autoprefixer（自动添加浏览器前缀）
 *  6. 插件 3：nested（支持嵌套规则，类似 SCSS）
 *
 * 运行方式：node Engineering/mini-postcss-plugin.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、CSS AST 节点
// ═══════════════════════════════════════════════════════════════════════════

class Root {
  constructor() {
    this.type = "root";
    this.nodes = [];
  }
  append(node) {
    node.parent = this;
    this.nodes.push(node);
  }
}

class Rule {
  constructor(selector) {
    this.type = "rule";
    this.selector = selector;
    this.nodes = []; // Declaration 列表
    this.parent = null;
  }
  append(node) {
    node.parent = this;
    this.nodes.push(node);
  }
  // 在当前规则后面插入新规则（用于 nested 插件展开嵌套）
  after(newNode) {
    if (this.parent) {
      const idx = this.parent.nodes.indexOf(this);
      newNode.parent = this.parent;
      this.parent.nodes.splice(idx + 1, 0, newNode);
    }
  }
  // 移除某个子节点
  removeChild(node) {
    const idx = this.nodes.indexOf(node);
    if (idx !== -1) this.nodes.splice(idx, 1);
  }
}

class Declaration {
  constructor(prop, value) {
    this.type = "decl";
    this.prop = prop;
    this.value = value;
    this.parent = null;
  }
  // 在当前声明前插入新声明
  before(newDecl) {
    if (this.parent) {
      const idx = this.parent.nodes.indexOf(this);
      newDecl.parent = this.parent;
      this.parent.nodes.splice(idx, 0, newDecl);
    }
  }
  clone(overrides = {}) {
    const d = new Declaration(
      overrides.prop || this.prop,
      overrides.value || this.value
    );
    return d;
  }
}

class AtRule {
  constructor(name, params) {
    this.type = "atrule";
    this.name = name;
    this.params = params;
    this.nodes = [];
    this.parent = null;
  }
  append(node) {
    node.parent = this;
    this.nodes.push(node);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、CSS 解析器
// ═══════════════════════════════════════════════════════════════════════════
//
// 简化版：支持基本的规则、声明、@规则、嵌套
// 真实 PostCSS 用 tokenizer + parser，处理更多边界情况

function parseCSS(css) {
  const root = new Root();
  const stack = [root]; // 当前所在的容器节点栈

  // 按行处理（简化，真实用 tokenizer）
  const lines = css.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("/*")) continue;

    const currentContainer = stack[stack.length - 1];

    // @规则
    const atMatch = line.match(/^@(\w+)\s*(.*?)\s*\{?\s*$/);
    if (atMatch && line.includes("{")) {
      const atrule = new AtRule(atMatch[1], atMatch[2]);
      currentContainer.append(atrule);
      stack.push(atrule);
      continue;
    }

    // 关闭大括号
    if (line === "}") {
      stack.pop();
      continue;
    }

    // 选择器 { 开头
    if (line.endsWith("{")) {
      const selector = line.replace("{", "").trim();
      const rule = new Rule(selector);
      currentContainer.append(rule);
      stack.push(rule);
      continue;
    }

    // 声明：prop: value;
    const declMatch = line.match(/^([\w-]+)\s*:\s*(.+?)\s*;?\s*$/);
    if (declMatch) {
      const decl = new Declaration(declMatch[1], declMatch[2].replace(/;$/, ""));
      currentContainer.append(decl);
      continue;
    }
  }

  return root;
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、CSS 生成器（AST → CSS 字符串）
// ═══════════════════════════════════════════════════════════════════════════

function generateCSS(node, indent = "") {
  let result = "";

  if (node.type === "root") {
    for (const child of node.nodes) {
      result += generateCSS(child, indent);
    }
  } else if (node.type === "rule") {
    result += `${indent}${node.selector} {\n`;
    for (const child of node.nodes) {
      result += generateCSS(child, indent + "  ");
    }
    result += `${indent}}\n`;
  } else if (node.type === "decl") {
    result += `${indent}${node.prop}: ${node.value};\n`;
  } else if (node.type === "atrule") {
    result += `${indent}@${node.name} ${node.params} {\n`;
    for (const child of node.nodes) {
      result += generateCSS(child, indent + "  ");
    }
    result += `${indent}}\n`;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、PostCSS 引擎
// ═══════════════════════════════════════════════════════════════════════════
//
// 引擎的职责：
//   1. 解析 CSS 为 AST
//   2. 依次执行每个插件（插件返回 visitor 对象）
//   3. 遍历 AST，对每个节点调用匹配的 visitor
//   4. 生成修改后的 CSS

class PostCSS {
  constructor(plugins = []) {
    this.plugins = plugins;
  }

  process(css) {
    const root = parseCSS(css);

    // 依次执行每个插件
    for (const plugin of this.plugins) {
      const visitor = typeof plugin === "function" ? plugin() : plugin;

      // 遍历 AST，调用匹配的 visitor
      this._walk(root, visitor);
    }

    return {
      css: generateCSS(root),
      root,
    };
  }

  _walk(node, visitor) {
    // 先处理当前节点
    if (visitor[node.type === "decl" ? "Declaration" : node.type === "rule" ? "Rule" : node.type === "atrule" ? "AtRule" : "Root"]) {
      const visitorKey = node.type === "decl" ? "Declaration" : node.type === "rule" ? "Rule" : node.type === "atrule" ? "AtRule" : "Root";
      visitor[visitorKey]?.(node);
    }

    // 递归处理子节点（拷贝数组，因为插件可能修改 nodes）
    if (node.nodes) {
      const children = [...node.nodes];
      for (const child of children) {
        this._walk(child, visitor);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、插件实现
// ═══════════════════════════════════════════════════════════════════════════

// ── 插件 1：px2rem ──
// 将 px 单位转为 rem（基准 rootValue，默认 16px = 1rem）
// 典型配置：rootValue: 75（移动端 750px 设计稿 → 10rem 宽）

function px2rem(opts = {}) {
  const rootValue = opts.rootValue || 16;
  const precision = opts.precision || 5;
  const exclude = opts.exclude || []; // 排除的属性

  return {
    postcssPlugin: "px2rem",
    Declaration(decl) {
      if (exclude.includes(decl.prop)) return;
      if (!decl.value.includes("px")) return;

      // 替换所有 Npx → N/rootValue rem
      decl.value = decl.value.replace(/(\d+(\.\d+)?)px/g, (match, num) => {
        const val = parseFloat(num);
        if (val === 0) return "0";
        const remVal = (val / rootValue).toFixed(precision).replace(/\.?0+$/, "");
        return `${remVal}rem`;
      });
    },
  };
}

// ── 插件 2：autoprefixer（简化版）──
// 为需要前缀的属性添加 -webkit-、-moz- 等前缀
// 真实 autoprefixer 查询 caniuse 数据库，这里硬编码常见属性

function autoprefixer() {
  // 需要添加前缀的属性 → 前缀列表
  const prefixMap = {
    "display": { "flex": ["-webkit-flex"] },  // display: flex
    "transform": ["-webkit-transform"],
    "transition": ["-webkit-transition"],
    "animation": ["-webkit-animation"],
    "user-select": ["-webkit-user-select", "-moz-user-select", "-ms-user-select"],
    "backdrop-filter": ["-webkit-backdrop-filter"],
  };

  return {
    postcssPlugin: "autoprefixer",
    Declaration(decl) {
      const prefixes = prefixMap[decl.prop];

      if (Array.isArray(prefixes)) {
        // 属性名需要前缀（如 transform → -webkit-transform）
        for (const prefix of [...prefixes].reverse()) {
          decl.before(decl.clone({ prop: prefix }));
        }
      } else if (typeof prefixes === "object" && prefixes[decl.value]) {
        // 属性值需要前缀（如 display: flex → display: -webkit-flex）
        for (const prefixedValue of [...prefixes[decl.value]].reverse()) {
          decl.before(decl.clone({ value: prefixedValue }));
        }
      }
    },
  };
}

// ── 插件 3：nested（嵌套规则展开）──
// 支持 SCSS 风格的嵌套语法
// .parent { .child { color: red } } → .parent .child { color: red }
//
// 这是 postcss-nested 的核心逻辑

function nested() {
  return {
    postcssPlugin: "nested",
    Rule(rule) {
      if (!rule.parent || rule.parent.type !== "rule") return;

      const parentRule = rule.parent;
      // 拼接选择器
      const newSelector = rule.selector.includes("&")
        ? rule.selector.replace(/&/g, parentRule.selector)
        : `${parentRule.selector} ${rule.selector}`;

      // 创建新的顶层规则
      const newRule = new Rule(newSelector);
      for (const child of rule.nodes) {
        newRule.append(child);
      }

      // 把新规则插到父规则后面
      parentRule.after(newRule);
      // 从父规则中移除嵌套规则
      parentRule.removeChild(rule);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini PostCSS 插件演示 ===\n");

// ── 测试 1：px2rem ──

console.log("【测试 1】px2rem 插件（rootValue: 16）\n");

const css1 = `
.container {
  width: 320px;
  padding: 16px 8px;
  font-size: 14px;
  border: 1px solid red;
}
`.trim();

console.log("  输入 CSS:");
css1.split("\n").forEach((l) => console.log("    " + l));

const result1 = new PostCSS([() => px2rem({ rootValue: 16 })]).process(css1);
console.log("\n  输出 CSS（px → rem）:");
result1.css.split("\n").forEach((l) => { if (l.trim()) console.log("    " + l); });

// ── 测试 2：autoprefixer ──

console.log("\n\n【测试 2】autoprefixer 插件\n");

const css2 = `
.box {
  display: flex;
  transform: rotate(45deg);
  user-select: none;
}
`.trim();

console.log("  输入 CSS:");
css2.split("\n").forEach((l) => console.log("    " + l));

const result2 = new PostCSS([autoprefixer]).process(css2);
console.log("\n  输出 CSS（添加浏览器前缀）:");
result2.css.split("\n").forEach((l) => { if (l.trim()) console.log("    " + l); });

// ── 测试 3：nested ──

console.log("\n\n【测试 3】nested 插件（嵌套展开）\n");

const css3 = `
.parent {
  color: blue;
  .child {
    color: red;
  }
}
`.trim();

console.log("  输入 CSS（嵌套语法）:");
css3.split("\n").forEach((l) => console.log("    " + l));

const result3 = new PostCSS([nested]).process(css3);
console.log("\n  输出 CSS（展开后）:");
result3.css.split("\n").forEach((l) => { if (l.trim()) console.log("    " + l); });

// ── 测试 4：多插件组合 ──

console.log("\n\n【测试 4】多插件组合（px2rem + autoprefixer）\n");

const css4 = `
.card {
  width: 375px;
  transform: scale(1.2);
  padding: 24px;
}
`.trim();

console.log("  输入 CSS:");
css4.split("\n").forEach((l) => console.log("    " + l));

const result4 = new PostCSS([
  () => px2rem({ rootValue: 75, precision: 4 }),
  autoprefixer,
]).process(css4);
console.log("\n  输出 CSS:");
result4.css.split("\n").forEach((l) => { if (l.trim()) console.log("    " + l); });

console.log("\n\n=== 面试要点 ===");
console.log("1. PostCSS = CSS 版的 Babel：CSS → AST → 插件修改 → 新 CSS");
console.log("2. AST 节点：Root > Rule(选择器) > Declaration(属性:值)，还有 AtRule / Comment");
console.log("3. 插件是 visitor 模式：{ Declaration(decl) {}, Rule(rule) {} }");
console.log("4. px2rem：正则替换 Npx → N/rootValue rem，移动端常用 rootValue=75");
console.log("5. autoprefixer：查 caniuse 数据决定要加哪些前缀（-webkit-/-moz-/-ms-）");
console.log("6. postcss-nested：拼接父子选择器，将嵌套规则展开为平铺规则");
console.log("7. 多插件按顺序执行，上一个插件的输出是下一个插件的输入（pipeline）");
