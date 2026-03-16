/**
 * Source Map 原理实现
 *
 * ═══════════════════════════════════════════════════════
 *  什么是 Source Map？
 * ═══════════════════════════════════════════════════════
 *
 * 浏览器执行的是打包/压缩后的代码，报错时显示的行列号对不上源码。
 * Source Map 是一个 JSON 文件，记录了"产物中的位置 → 源码中的位置"的映射关系。
 * 浏览器通过 //# sourceMappingURL=xxx.map 找到映射文件，在 DevTools 中还原源码位置。
 *
 * ═══════════════════════════════════════════════════════
 *  Source Map 的核心格式（.map 文件）
 * ═══════════════════════════════════════════════════════
 *
 *  {
 *    "version": 3,                          // 固定为 3（当前规范版本）
 *    "file": "bundle.js",                   // 产物文件名
 *    "sources": ["../src/index.js", ...],   // 源文件列表
 *    "sourcesContent": ["原始代码...", ...], // 源码内容（可选，内嵌后不需要原始文件）
 *    "names": ["greeting", "name", ...],    // 标识符列表（压缩重命名时用）
 *    "mappings": "AAAA,SAAS;AACT,..."       // 核心：VLQ 编码的位置映射
 *  }
 *
 * ═══════════════════════════════════════════════════════
 *  mappings 字段的编码规则
 * ═══════════════════════════════════════════════════════
 *
 *  mappings 是一个字符串，用 ; 分隔产物的每一行，用 , 分隔同一行内的每个映射段。
 *
 *  每个映射段（segment）包含 4-5 个字段，都用 VLQ 编码：
 *    字段 0：产物中的列号（相对于上一个 segment 的列号的偏移量）
 *    字段 1：源文件索引（在 sources 数组中的下标偏移量）
 *    字段 2：源码行号偏移量
 *    字段 3：源码列号偏移量
 *    字段 4：names 索引偏移量（可选，用于标识符映射）
 *
 *  为什么用偏移量（相对值）而不是绝对值？
 *    偏移量通常很小（大部分是 0 或个位数），VLQ 编码后只需 1-2 个字符。
 *    如果用绝对值，行号可能是几百上千，VLQ 编码后会很长。
 *
 * ═══════════════════════════════════════════════════════
 *  VLQ（Variable-Length Quantity）编码
 * ═══════════════════════════════════════════════════════
 *
 *  VLQ 用 Base64 字符表示变长整数：
 *    1. 将整数转为二进制，最低位存符号（0正1负）
 *    2. 每 5 位为一组，从低到高排列
 *    3. 除了最后一组，每组的第 6 位（续延位）设为 1
 *    4. 每组映射到 Base64 字符
 *
 *  示例：编码数字 12
 *    1. 12 → 二进制 1100，左移1位加符号位 → 11000
 *    2. 低 5 位 = 11000 = 24，无续延 → Base64[24] = 'Y'
 *    结果：'Y'
 *
 *  示例：编码数字 -1
 *    1. -1 → |1| = 1，二进制 1，左移1位加符号位1 → 11
 *    2. 低 5 位 = 00011 = 3，无续延 → Base64[3] = 'D'
 *    结果：'D'
 *
 * ═══════════════════════════════════════════════════════
 *  webpack devtool 选项的区别
 * ═══════════════════════════════════════════════════════
 *
 *  "source-map"
 *    完整的独立 .map 文件，包含精确到列的映射
 *    构建慢，体积大，映射最精确
 *
 *  "cheap-source-map"
 *    只映射到行，不映射到列（每行只生成一个 segment）
 *    构建较快，.map 文件小很多
 *
 *  "eval-source-map"
 *    不生成 .map 文件，把 source map 内嵌到 eval() 中：
 *    eval("代码...\n//# sourceURL=xxx\n//# sourceMappingURL=data:...")
 *    每个模块独立 eval，重新构建时只需重新 eval 变化的模块 → 增量构建最快
 *
 *  "cheap-module-source-map"
 *    映射到 loader 处理前的源码（而非 loader 处理后的中间结果）
 *    适合有 TypeScript/Babel 转换的项目
 *
 *  "hidden-source-map"
 *    生成 .map 文件但不在产物中添加 sourceMappingURL 注释
 *    用于错误监控服务（Sentry 等）上传 source map
 *
 * 运行方式：cd WebPack/mini-webpack && npm install && cd .. && node source-map-demo.js
 */

const fs = require("fs");
const path = require("path");
// 复用 mini-webpack 的 babel 依赖
const parser = require("./mini-webpack/node_modules/@babel/parser");
const traverse = require("./mini-webpack/node_modules/@babel/traverse").default;
const generator = require("./mini-webpack/node_modules/@babel/generator").default;
const types = require("./mini-webpack/node_modules/@babel/types");

// ─── Base64 VLQ 编码实现 ─────────────────────────────────────────────────
//
// 这是 Source Map 的底层编码格式，所有位置信息最终都要编码为 VLQ 字符串。
// 真实实现中一般用 mozilla/source-map 库，这里手写以理解原理。

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * 将一个整数编码为 VLQ Base64 字符串
 *
 * 步骤：
 *   1. 符号处理：负数 → 最低位设为 1，正数 → 最低位设为 0
 *   2. 每次取 5 位（低位在前），如果还有剩余位则设置续延标志（第 6 位 = 1）
 *   3. 每 6 位映射到一个 Base64 字符
 *
 * @param {number} value  要编码的整数（可以是负数）
 * @returns {string}      VLQ 编码的 Base64 字符串
 */
function encodeVLQ(value) {
  let result = "";

  // 第 1 步：将符号移到最低位
  // 正数 5 → 二进制 101 → 左移 → 1010（最低位 0 表示正数）
  // 负数-5 → |5| → 101 → 左移 → 1011（最低位 1 表示负数）
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;

  // 第 2 步：每次取 5 位编码
  do {
    let digit = vlq & 0b11111; // 取低 5 位
    vlq >>>= 5; // 右移 5 位

    if (vlq > 0) {
      digit |= 0b100000; // 还有更多位 → 设置续延标志（第 6 位 = 1）
    }

    result += BASE64_CHARS[digit];
  } while (vlq > 0);

  return result;
}

/**
 * 将 VLQ Base64 字符串解码为整数（用于验证编码正确性）
 */
function decodeVLQ(str) {
  let i = 0;
  let result = 0;
  let shift = 0;

  do {
    const charIndex = BASE64_CHARS.indexOf(str[i]);
    const hasContinuation = charIndex & 0b100000;
    const digit = charIndex & 0b11111;
    result += digit << shift;
    shift += 5;
    i++;
    if (!hasContinuation) break;
  } while (i < str.length);

  // 最低位是符号位
  const isNegative = result & 1;
  result >>>= 1;

  return { value: isNegative ? -result : result, charsConsumed: i };
}

/**
 * 将一个 segment（4-5 个整数）编码为 VLQ 字符串
 *
 * @param {number[]} segment  [产物列偏移, 源文件偏移, 源码行偏移, 源码列偏移, (名称偏移)]
 * @returns {string}          VLQ 编码字符串，如 "AACA"
 */
function encodeSegment(segment) {
  return segment.map(encodeVLQ).join("");
}

// ─── 示例源码 ───────────────────────────────────────────────────────────────

const sources = {
  "./src/greeting.js": `function greeting(name) {
  return 'Hello, ' + name + '!';
}
module.exports = greeting;`,

  "./src/index.js": `const greeting = require('./greeting');
const result = greeting('World');
console.log(result);`,
};

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 1：编译模块（保留源码位置信息）
// ═══════════════════════════════════════════════════════════════════════════
//
// 与 mini-webpack 的 buildModule 类似，但额外追踪每个模块在 bundle 中的起始行号。
// 这是生成 source map 的关键 —— 需要知道每个模块的代码最终出现在 bundle 的哪一行。

function buildModules(entryId) {
  const modules = {};
  const visited = new Set();

  function build(moduleId) {
    if (visited.has(moduleId)) return;
    visited.add(moduleId);

    const source = sources[moduleId];
    if (!source) throw new Error("模块未找到: " + moduleId);

    const ast = parser.parse(source, { sourceType: "module" });
    const deps = [];

    traverse(ast, {
      CallExpression({ node }) {
        if (node.callee.name === "require" && node.callee.type === "Identifier") {
          const depName = node.arguments[0]?.value;
          if (typeof depName !== "string") return;
          let depId = depName;
          if (!depId.startsWith("./src/")) depId = "./src/" + depId.replace("./", "");
          if (!depId.endsWith(".js")) depId += ".js";
          node.arguments = [types.stringLiteral(depId)];
          deps.push(depId);
        }
      },
    });

    modules[moduleId] = {
      originalSource: source,
      transformedCode: generator(ast).code,
    };

    deps.forEach(build);
  }

  build(entryId);
  return modules;
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 2：生成 bundle + 计算每个模块在 bundle 中的偏移
// ═══════════════════════════════════════════════════════════════════════════
//
// Source Map 的核心难点：需要精确知道每个模块的代码最终落在 bundle 的第几行。
// 因为 bundle 前面有运行时代码（modules 对象声明、require 函数等），
// 每个模块的代码被缩进和包裹后行号会发生偏移。

function generateBundleWithOffsets(modules, entryId) {
  // 运行时前缀（与 mini-webpack 的 getSource 结构一致）
  const prefix = `(() => {
  var modules = {`;

  const suffix = `  };
  var cache = {};
  function require(moduleId) {
    if (cache[moduleId]) return cache[moduleId].exports;
    var module = (cache[moduleId] = { exports: {} });
    modules[moduleId](module, module.exports, require);
    return module.exports;
  }
  require("${entryId}");
})();`;

  // 逐个模块生成代码，记录每个模块在 bundle 中的起始行号
  const moduleEntries = [];
  const moduleOffsets = {}; // { moduleId: 在 bundle 中代码开始的行号（0-based） }

  let currentLine = prefix.split("\n").length; // prefix 占的行数

  for (const [moduleId, { transformedCode }] of Object.entries(modules)) {
    const header = `    "${moduleId}": (module, exports, require) => {`;
    const codeLines = transformedCode.split("\n").map((l) => "      " + l);
    const footer = `    },`;

    // 模块实际代码从 header 下一行开始
    moduleOffsets[moduleId] = currentLine + 1; // +1 跳过 header 行

    const entry = [header, ...codeLines, footer].join("\n");
    moduleEntries.push(entry);

    currentLine += entry.split("\n").length;
  }

  const bundle = [prefix, moduleEntries.join("\n"), suffix].join("\n");

  return { bundle, moduleOffsets };
}

// ═══════════════════════════════════════════════════════════════════════════
// 阶段 3：生成 Source Map
// ═══════════════════════════════════════════════════════════════════════════
//
// 遍历每个模块，为每一行生成映射段（segment）。
// 每个 segment 记录：bundle 中的列号 → 源文件 + 源码行号 + 源码列号
//
// 这里实现的是 "cheap-source-map" 级别：只映射到行，不映射到列。
// 每行只生成一个 segment，列号都是 0。
//
// 如果要实现完整的 "source-map"（精确到列），需要：
//   1. 对 AST 中每个节点追踪 start/end 位置
//   2. 对比转换前后节点的位置变化
//   3. 为每个变化的位置生成一个 segment

function generateSourceMap(modules, moduleOffsets, bundleFileName) {
  const sourcesList = Object.keys(modules);
  const sourcesContent = sourcesList.map((id) => modules[id].originalSource);

  // mappings 的结构：每行一个字符串，行内用逗号分隔多个 segment
  // 用 ; 连接所有行（; 代表换行）
  const bundleLineCount =
    Object.values(moduleOffsets).reduce((max, offset) => {
      const moduleId = Object.keys(moduleOffsets).find((k) => moduleOffsets[k] === offset);
      const lines = modules[moduleId].transformedCode.split("\n").length;
      return Math.max(max, offset + lines);
    }, 0) + 10; // 多留一些行给 suffix

  // 初始化所有行的 mappings 为空
  const mappingsLines = new Array(bundleLineCount).fill("");

  // VLQ 是相对编码，需要维护"上一个 segment 的状态"
  let prevSourceIndex = 0;
  let prevSourceLine = 0;
  let prevSourceCol = 0;

  for (let si = 0; si < sourcesList.length; si++) {
    const moduleId = sourcesList[si];
    const bundleStartLine = moduleOffsets[moduleId];
    const originalLines = modules[moduleId].originalSource.split("\n");

    for (let origLine = 0; origLine < originalLines.length; origLine++) {
      const bundleLine = bundleStartLine + origLine;
      if (bundleLine >= bundleLineCount) break;

      // 每行的第一个 segment：
      //   字段 0：产物列号偏移（因为有缩进，这里是 6，即 "      " 的长度）
      //   字段 1：源文件索引偏移
      //   字段 2：源码行号偏移
      //   字段 3：源码列号偏移
      //
      // 所有字段都是相对于上一个 segment 的偏移量
      const genCol = 6; // bundle 中的缩进列数
      const segment = [
        genCol, // 产物列号（每行第一个 segment 用绝对值）
        si - prevSourceIndex, // 源文件索引偏移
        origLine - prevSourceLine, // 源码行号偏移
        0 - prevSourceCol, // 源码列号偏移（源码列从 0 开始）
      ];

      mappingsLines[bundleLine] = encodeSegment(segment);

      // 更新状态
      prevSourceIndex = si;
      prevSourceLine = origLine;
      prevSourceCol = 0;
    }
  }

  const mappings = mappingsLines.join(";");

  return {
    version: 3,
    file: bundleFileName,
    sources: sourcesList,
    sourcesContent,
    names: [],
    mappings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 执行
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Source Map 原理演示 ===\n");

// 1. VLQ 编码演示
console.log("【VLQ 编码演示】\n");
const testValues = [0, 1, -1, 5, -5, 12, 100, -100];
testValues.forEach((v) => {
  const encoded = encodeVLQ(v);
  const decoded = decodeVLQ(encoded);
  console.log(`  ${v.toString().padStart(4)} → VLQ: "${encoded}"  → 解码: ${decoded.value}`);
});

// 2. Segment 编码演示
console.log("\n【Segment 编码演示】\n");
console.log("  segment = [产物列偏移, 源文件偏移, 源行偏移, 源列偏移]");
const testSegments = [
  { segment: [0, 0, 0, 0], desc: "产物第0列 → 源文件0, 第0行, 第0列" },
  { segment: [6, 0, 1, 0], desc: "产物第6列 → 源文件0, 第1行, 第0列" },
  { segment: [0, 1, 0, 0], desc: "产物第0列 → 源文件1（切换到下一个文件）" },
];
testSegments.forEach(({ segment, desc }) => {
  console.log(`  [${segment.join(",")}] → "${encodeSegment(segment)}"  (${desc})`);
});

// 3. 编译 + 生成 bundle
console.log("\n【编译模块】\n");
const entryId = "./src/index.js";
const modules = buildModules(entryId);

for (const [id, { transformedCode }] of Object.entries(modules)) {
  console.log(`  ${id}:`);
  transformedCode.split("\n").forEach((l, i) => console.log(`    ${i + 1}: ${l}`));
  console.log();
}

// 4. 生成 bundle + 偏移
console.log("【生成 bundle】\n");
const { bundle, moduleOffsets } = generateBundleWithOffsets(modules, entryId);

for (const [id, offset] of Object.entries(moduleOffsets)) {
  console.log(`  ${id} → bundle 第 ${offset + 1} 行开始`);
}

console.log("\n  bundle 内容：");
bundle.split("\n").forEach((l, i) => {
  console.log(`  ${String(i + 1).padStart(3)}| ${l}`);
});

// 5. 生成 source map
console.log("\n【生成 Source Map】\n");
const sourceMap = generateSourceMap(modules, moduleOffsets, "bundle.js");

console.log("  .map 文件内容：");
console.log(JSON.stringify(sourceMap, null, 2).split("\n").map((l) => "  " + l).join("\n"));

// 6. 解析 mappings 演示
console.log("\n【解析 mappings（部分非空行）】\n");
const mappingLines = sourceMap.mappings.split(";");

// 解析时重置状态
let dPrevSrc = 0, dPrevLine = 0, dPrevCol = 0;

mappingLines.forEach((line, bundleLine) => {
  if (!line) return;

  // 解码这一行的 segment
  let pos = 0;
  const fields = [];
  while (pos < line.length) {
    const { value, charsConsumed } = decodeVLQ(line.slice(pos));
    fields.push(value);
    pos += charsConsumed;
  }

  if (fields.length >= 4) {
    dPrevSrc += fields[1];
    dPrevLine += fields[2];
    dPrevCol += fields[3];

    const srcFile = sourceMap.sources[dPrevSrc] || "?";
    console.log(
      `  bundle 第 ${String(bundleLine + 1).padStart(2)} 行, 列 ${fields[0]}` +
      `  →  ${srcFile} 第 ${dPrevLine + 1} 行, 列 ${dPrevCol}` +
      `  (VLQ: "${line}")`
    );
  }
});

// 7. 写入文件
const outDir = path.resolve(__dirname, "source-map-dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const bundleWithComment = bundle + "\n//# sourceMappingURL=bundle.js.map\n";
fs.writeFileSync(path.join(outDir, "bundle.js"), bundleWithComment);
fs.writeFileSync(path.join(outDir, "bundle.js.map"), JSON.stringify(sourceMap));

fs.writeFileSync(
  path.join(outDir, "index.html"),
  `<!DOCTYPE html>
<html><head><title>Source Map Demo</title></head>
<body>
<h1>Source Map Demo</h1>
<p>打开 DevTools → Sources 面板，可以看到原始源码文件</p>
<p>在控制台中点击日志输出右侧的文件链接，会跳转到原始源码位置</p>
<script src="bundle.js"></script>
</body></html>`
);

console.log("\n产出文件已写入 " + outDir + "/");
console.log("  bundle.js      ← 打包产物（尾部带 sourceMappingURL）");
console.log("  bundle.js.map  ← Source Map 文件");
console.log("  index.html     ← 测试页面\n");
console.log("在浏览器中打开 index.html：");
console.log("  1. DevTools → Sources 面板可以看到原始的 greeting.js 和 index.js");
console.log("  2. 点击 console.log 输出右侧的链接，跳转到原始源码位置");
console.log("  3. 在原始源码上设断点，调试时会停在正确的位置");

console.log("\nwebpack devtool 选项速查：");
console.log("  source-map              → 完整映射，精确到列，独立 .map 文件");
console.log("  cheap-source-map        → 只映射到行（本文件实现的级别）");
console.log("  eval-source-map         → map 内嵌在 eval() 中，增量构建最快");
console.log("  cheap-module-source-map → 映射到 loader 之前的源码（适合 TS/Babel）");
console.log("  hidden-source-map       → 有 .map 但不加注释，用于 Sentry 上传");
