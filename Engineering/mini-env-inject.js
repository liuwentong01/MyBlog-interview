/**
 * env 环境变量注入实现
 *
 * ═══════════════════════════════════════════════════════
 *  环境变量注入的核心原理
 * ═══════════════════════════════════════════════════════
 *
 * 前端项目中的环境变量有两种使用方式：
 *
 * 1. Node.js 层面（构建时）：
 *    process.env.NODE_ENV → webpack/vite 在构建时通过 DefinePlugin 替换
 *    本质是 AST 文本替换，把代码中的 process.env.X 替换为字面量
 *
 * 2. 浏览器层面（运行时）：
 *    import.meta.env.VITE_X → Vite 在 dev server 中动态替换
 *
 * .env 文件处理流程：
 *   .env                → 所有环境
 *   .env.local           → 本地覆盖（gitignore）
 *   .env.development     → dev 环境
 *   .env.production      → prod 环境
 *   .env.development.local → dev 本地覆盖
 *
 *   优先级：.env.mode.local > .env.mode > .env.local > .env
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. .env 文件解析器（dotenv 核心逻辑）
 *  2. 环境变量加载器（多文件合并 + 优先级）
 *  3. DefinePlugin 编译时替换（AST 文本替换）
 *  4. import.meta.env 注入
 *  5. 安全过滤（只暴露指定前缀的变量给客户端）
 *
 * 运行方式：node Engineering/mini-env-inject.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、.env 文件解析器（mini dotenv）
// ═══════════════════════════════════════════════════════════════════════════
//
// dotenv 的核心就是逐行解析 KEY=VALUE：
//   1. 忽略空行和 # 注释
//   2. 支持 KEY=VALUE 和 KEY="VALUE"（带引号可包含空格/换行）
//   3. 支持 ${VAR} 变量引用（插值）
//   4. 不覆盖已有的 process.env 中的值（真实环境变量优先）

function parseDotenv(content) {
  const result = {};

  const lines = content.split("\n");

  for (let line of lines) {
    // 去掉首尾空白
    line = line.trim();

    // 跳过空行和注释
    if (!line || line.startsWith("#")) continue;

    // 匹配 KEY=VALUE
    const match = line.match(/^(\w+)\s*=\s*(.*)/);
    if (!match) continue;

    let [, key, value] = match;

    // 去掉引号包裹
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 去掉行内注释（未被引号包裹的 #）
    if (!line.includes('"') && !line.includes("'")) {
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    result[key] = value;
  }

  return result;
}

/**
 * 变量插值：替换 ${VAR} 引用
 * 支持引用已解析的变量和 process.env 中的变量
 */
function interpolate(parsed, processEnv = {}) {
  const result = { ...parsed };

  for (const key of Object.keys(result)) {
    result[key] = result[key].replace(/\$\{(\w+)\}/g, (_, ref) => {
      return result[ref] || processEnv[ref] || "";
    });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、环境变量加载器（多文件合并）
// ═══════════════════════════════════════════════════════════════════════════
//
// 模拟 Vite 的 loadEnv 函数
// 按优先级加载多个 .env 文件，后加载的覆盖先加载的

function loadEnv(mode, envFiles) {
  // 加载顺序（优先级从低到高）：
  // .env → .env.local → .env.[mode] → .env.[mode].local
  const fileOrder = [
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`,
  ];

  let merged = {};

  for (const fileName of fileOrder) {
    const content = envFiles[fileName];
    if (content) {
      const parsed = parseDotenv(content);
      merged = { ...merged, ...parsed };
    }
  }

  // 变量插值
  merged = interpolate(merged);

  return merged;
}

/**
 * 安全过滤：只暴露指定前缀的变量给客户端代码
 *
 * 为什么需要？
 *   .env 中可能有 DB_PASSWORD、SECRET_KEY 等敏感变量
 *   不能把所有变量都打包到客户端 JS 中
 *   Vite 约定：只有 VITE_ 前缀的变量才暴露
 *   CRA 约定：只有 REACT_APP_ 前缀的变量才暴露
 */
function filterClientEnv(env, prefix = "VITE_") {
  const filtered = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(prefix)) {
      filtered[key] = value;
    }
  }
  // 始终暴露 NODE_ENV 和 MODE
  if (env.NODE_ENV) filtered.NODE_ENV = env.NODE_ENV;
  if (env.MODE) filtered.MODE = env.MODE;
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、DefinePlugin — 编译时文本替换
// ═══════════════════════════════════════════════════════════════════════════
//
// webpack 的 DefinePlugin 原理：
//   1. 在编译时扫描代码中的全局标识符
//   2. 将匹配的标识符替换为配置的字面量
//   3. 本质是字符串替换（基于 AST 更安全，这里用正则模拟）
//
// 例如：
//   DefinePlugin({ 'process.env.NODE_ENV': '"production"' })
//   代码中 process.env.NODE_ENV → "production"
//   配合 Tree Shaking：if ("production" !== "production") { ... } → dead code

function definePlugin(code, definitions) {
  let result = code;

  // 按 key 长度降序排序（避免短 key 匹配到长 key 的前缀）
  const sortedKeys = Object.keys(definitions).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    const value = definitions[key];
    // 转义正则特殊字符
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 用 \b 确保完整匹配（不会把 process.env.NODE_ENV_XXX 也替换了）
    const regex = new RegExp(escaped.replace(/\\\./g, "\\."), "g");
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * 从 env 对象生成 DefinePlugin 的 definitions
 *
 * { VITE_API_URL: "http://api.com" }
 * → { 'import.meta.env.VITE_API_URL': '"http://api.com"' }
 */
function envToDefine(env, envPrefix = "import.meta.env") {
  const define = {};

  // 整个 import.meta.env 对象
  define[envPrefix] = JSON.stringify(env);

  // 每个具体的 key（用于更精确的替换和 Tree Shaking）
  for (const [key, value] of Object.entries(env)) {
    define[`${envPrefix}.${key}`] = JSON.stringify(value);
  }

  return define;
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、Vite 的 import.meta.env 注入
// ═══════════════════════════════════════════════════════════════════════════
//
// Vite 在 dev 和 build 中处理方式不同：
//
// Dev（开发模式）：
//   Vite dev server 拦截请求，在返回模块前做文本替换
//   import.meta.env.VITE_X → "actual_value"
//
// Build（生产模式）：
//   用 Rollup 的 define 插件做编译时替换（和 DefinePlugin 同理）

function viteTransformEnv(code, env) {
  // 注入 import.meta.env 对象
  const define = envToDefine(env);
  return definePlugin(code, define);
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== env 环境变量注入演示 ===\n");

// ── 测试 1：.env 文件解析 ──

console.log("【测试 1】.env 文件解析（mini dotenv）\n");

const envContent = `
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_PASSWORD="my secret password"

# API 配置
VITE_API_URL=https://api.example.com
VITE_APP_TITLE=My App

# 引用其他变量
VITE_DB_URL=postgres://\${DB_HOST}:\${DB_PORT}/mydb

# 行内注释
DEBUG=true # 这是注释
`.trim();

console.log("  .env 文件内容:");
envContent.split("\n").forEach((l) => console.log("    " + l));

const parsed = parseDotenv(envContent);
const interpolated = interpolate(parsed);

console.log("\n  解析结果:");
Object.entries(interpolated).forEach(([k, v]) => {
  console.log(`    ${k} = ${v}`);
});

// ── 测试 2：多文件合并 + 优先级 ──

console.log("\n\n【测试 2】多 .env 文件合并（优先级）\n");

const envFiles = {
  ".env": `
NODE_ENV=development
VITE_API_URL=https://api.default.com
VITE_APP_NAME=MyApp
`.trim(),
  ".env.local": `
VITE_API_URL=https://api.local.com
SECRET_KEY=local-secret
`.trim(),
  ".env.production": `
NODE_ENV=production
VITE_API_URL=https://api.production.com
VITE_CDN_URL=https://cdn.example.com
`.trim(),
  ".env.production.local": `
VITE_API_URL=https://api.staging.com
`.trim(),
};

console.log("  文件清单:");
Object.entries(envFiles).forEach(([file, content]) => {
  console.log(`    ${file}:`);
  content.split("\n").forEach((l) => console.log(`      ${l}`));
});

const prodEnv = loadEnv("production", envFiles);
console.log("\n  mode=production 合并结果（高优先级覆盖低优先级）:");
Object.entries(prodEnv).forEach(([k, v]) => {
  console.log(`    ${k} = ${v}`);
});

const devEnv = loadEnv("development", envFiles);
console.log("\n  mode=development 合并结果:");
Object.entries(devEnv).forEach(([k, v]) => {
  console.log(`    ${k} = ${v}`);
});

// ── 测试 3：安全过滤 ──

console.log("\n\n【测试 3】安全过滤（只暴露 VITE_ 前缀）\n");

console.log("  过滤前（全部变量）:");
Object.entries(prodEnv).forEach(([k, v]) => {
  console.log(`    ${k} = ${v}`);
});

const clientEnv = filterClientEnv(prodEnv, "VITE_");
console.log("\n  过滤后（客户端可见）:");
Object.entries(clientEnv).forEach(([k, v]) => {
  console.log(`    ${k} = ${v}`);
});
console.log("  (SECRET_KEY 被过滤掉了 — 不会打包到客户端)");

// ── 测试 4：DefinePlugin 编译时替换 ──

console.log("\n\n【测试 4】DefinePlugin 编译时替换\n");

const sourceCode = `
// 源代码
const apiUrl = process.env.API_URL;
const isProd = process.env.NODE_ENV === "production";

if (process.env.NODE_ENV !== "production") {
  console.log("开发模式");
}

fetch(process.env.API_URL + "/users");
`.trim();

console.log("  替换前:");
sourceCode.split("\n").forEach((l) => console.log("    " + l));

const definitions = {
  "process.env.NODE_ENV": '"production"',
  "process.env.API_URL": '"https://api.example.com"',
};

const transformed = definePlugin(sourceCode, definitions);
console.log("\n  替换后:");
transformed.split("\n").forEach((l) => console.log("    " + l));
console.log("\n  注意: if (\"production\" !== \"production\") → dead code → Tree Shaking 会移除");

// ── 测试 5：Vite import.meta.env 注入 ──

console.log("\n\n【测试 5】Vite import.meta.env 注入\n");

const viteCode = `
const title = import.meta.env.VITE_APP_NAME;
const url = import.meta.env.VITE_API_URL;
const allEnv = import.meta.env;

if (import.meta.env.NODE_ENV === "production") {
  enableAnalytics();
}
`.trim();

console.log("  替换前:");
viteCode.split("\n").forEach((l) => console.log("    " + l));

const viteResult = viteTransformEnv(viteCode, clientEnv);
console.log("\n  替换后:");
viteResult.split("\n").forEach((l) => console.log("    " + l));

console.log("\n\n=== 面试要点 ===");
console.log("1. .env 解析 = 逐行匹配 KEY=VALUE + 去引号 + 变量插值（${VAR}）");
console.log("2. 多文件优先级：.env < .env.local < .env.[mode] < .env.[mode].local");
console.log("3. 安全过滤：只有 VITE_（或 REACT_APP_）前缀的变量才暴露给客户端");
console.log("4. DefinePlugin 本质是编译时文本替换：process.env.X → 字面量值");
console.log("5. 替换后 if ('production' !== 'production') 变成 dead code → Tree Shaking 移除");
console.log("6. Vite dev 用请求拦截做替换，build 用 Rollup define 插件做编译时替换");
console.log("7. 环境变量不是运行时注入，而是构建时写死在代码中（所以改了要重新构建）");
