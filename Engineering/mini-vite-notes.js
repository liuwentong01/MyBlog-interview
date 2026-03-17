/**
 * Vite 核心原理 — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  Vite vs Webpack 的本质区别
 * ═══════════════════════════════════════════════════════
 *
 * Webpack（Bundle-based）：
 *   启动时把所有模块打包成 bundle → 再启动 dev server
 *   项目越大 → 打包越慢 → 启动越慢
 *   HMR：修改一个文件 → 重新打包受影响的 chunk → 发送到浏览器
 *
 * Vite（Native ESM-based / Bundleless）：
 *   利用浏览器原生 ESM import → 不打包，按需编译
 *   启动时只启动 dev server（几乎瞬间）→ 浏览器请求模块 → 即时编译返回
 *   HMR：修改一个文件 → 只编译这一个文件 → 通过 WebSocket 通知浏览器
 *
 * ═══════════════════════════════════════════════════════
 *  Vite Dev Server 工作流程
 * ═══════════════════════════════════════════════════════
 *
 * 1. 浏览器加载 index.html
 *    <script type="module" src="/src/main.tsx"></script>
 *    ↑ type="module" 让浏览器用原生 ESM 加载
 *
 * 2. 浏览器发起请求：GET /src/main.tsx
 *
 * 3. Vite Dev Server 拦截请求：
 *    a. 读取 /src/main.tsx 源文件
 *    b. 用 esbuild/SWC 编译 TSX → JS（极快，Go/Rust 实现）
 *    c. 改写 import 路径：
 *       import React from 'react'
 *       → import React from '/node_modules/.vite/deps/react.js?v=xxx'
 *       （裸模块 → 预构建的缓存路径）
 *    d. 返回编译后的 JS
 *
 * 4. 浏览器执行 main.tsx → 遇到 import → 继续发起请求
 *    → Vite 按需编译，只编译用到的模块（懒编译）
 *
 * ═══════════════════════════════════════════════════════
 *  依赖预构建（Pre-bundling）
 * ═══════════════════════════════════════════════════════
 *
 * 问题：
 *   lodash-es 有 600+ 个小模块 → 浏览器发 600+ 个 HTTP 请求 → 极慢
 *   CJS 模块（如 React）浏览器不能直接加载
 *
 * 解决：Vite 在启动时用 esbuild 预构建 node_modules 中的依赖
 *
 *   1. 扫描入口文件，找到所有 bare import（如 'react', 'lodash-es'）
 *   2. 用 esbuild 将每个依赖打包为单个 ESM 文件
 *      - CJS → ESM 转换
 *      - 600 个小模块 → 1 个文件
 *   3. 缓存到 node_modules/.vite/deps/
 *   4. 只有依赖版本变化或手动清理时才重新预构建
 *
 *   esbuild 为什么快？
 *   - Go 语言编写 → 编译型语言 → 比 JS 快 10-100x
 *   - 高度并行化 → 充分利用多核 CPU
 *   - 不做 AST → 代码的完整转换，只做必要的处理
 *
 * ═══════════════════════════════════════════════════════
 *  Vite HMR 机制
 * ═══════════════════════════════════════════════════════
 *
 * HMR 流程：
 *   1. 文件变化 → chokidar 监听到
 *   2. 确定变化的模块 + 受影响的模块（模块依赖图）
 *   3. 重新编译变化的模块
 *   4. 通过 WebSocket 发送更新消息：
 *      { type: "update", updates: [{ path, timestamp }] }
 *   5. 浏览器收到消息 → 重新 import 变化的模块（加 ?t=timestamp 绕过缓存）
 *   6. 执行模块中的 import.meta.hot.accept 回调
 *
 * import.meta.hot API：
 *   import.meta.hot.accept()             — 接受自身更新
 *   import.meta.hot.accept('./dep', cb)  — 接受依赖更新
 *   import.meta.hot.dispose(cb)          — 清理副作用
 *   import.meta.hot.invalidate()         — 强制全量刷新
 *
 * HMR 边界：
 *   修改 App.vue → App.vue 有 accept → 只更新 App
 *   修改 utils.js → utils.js 无 accept → 向上冒泡找 accept
 *   冒泡到根 → 无人 accept → full reload
 *
 * ═══════════════════════════════════════════════════════
 *  Vite 的构建模式（Production Build）
 * ═══════════════════════════════════════════════════════
 *
 * Dev 用原生 ESM → 生产不行（太多请求、无法 tree shake）
 * 生产构建用 Rollup：
 *   - Tree Shaking（Rollup 的 ESM 分析比 webpack 更彻底）
 *   - Code Splitting（动态 import → 自动分 chunk）
 *   - CSS 提取 + 压缩
 *   - 资源 hash（缓存友好）
 *
 * 为什么 Dev 用 esbuild，Build 用 Rollup？
 *   esbuild：极快但功能不全（不支持完整的 code splitting、CSS 处理不够好）
 *   Rollup：功能完整但较慢（生产构建可以接受等待时间）
 *   未来方向：Rolldown（Rust 重写的 Rollup，统一 dev 和 build）
 *
 * ═══════════════════════════════════════════════════════
 *  Vite 插件系统
 * ═══════════════════════════════════════════════════════
 *
 * Vite 插件 = Rollup 插件的超集
 *
 * 钩子函数：
 *   config()        — 修改 Vite 配置
 *   configResolved() — 配置解析完毕
 *   configureServer() — 自定义 dev server（添加中间件）
 *   transformIndexHtml() — 修改 HTML
 *   resolveId()     — 自定义模块解析（bare import → 实际路径）
 *   load()          — 自定义模块加载（虚拟模块）
 *   transform()     — 编译转换（核心：对源码做任意变换）
 *   handleHotUpdate() — 自定义 HMR 逻辑
 *
 * Vite 特有钩子（Rollup 没有的）：
 *   configureServer / transformIndexHtml / handleHotUpdate
 *
 * ═══════════════════════════════════════════════════════
 *  关键实现细节
 * ═══════════════════════════════════════════════════════
 *
 * 【模块解析（resolveId）】
 *   import 'react'
 *   → 先查 node_modules/.vite/deps/react.js（预构建缓存）
 *   → 没有则按 Node resolution 查找
 *   → 返回绝对路径
 *
 * 【模块转换（transform）】
 *   .tsx → esbuild 编译为 JS
 *   .vue → @vitejs/plugin-vue 拆分为 script/template/style
 *   .css → 转为 JS 模块（dev: 注入 <style>，build: 提取文件）
 *   .json → export default { ... }
 *   .svg → 根据 import 方式返回 URL 或组件
 *
 * 【import 路径重写】
 *   原始：import { useState } from 'react'
 *   重写：import { useState } from '/node_modules/.vite/deps/react.js?v=abc123'
 *   目的：
 *   - 裸模块 → 绝对路径（浏览器不认识裸模块）
 *   - 加版本 hash → 强缓存（304 Not Modified）
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. Vite Dev = Native ESM + 按需编译（不打包）→ 启动瞬间，HMR 极快
 * 2. 依赖预构建：esbuild 将 node_modules 依赖打成单个 ESM（解决多文件请求和 CJS 问题）
 * 3. Dev 用 esbuild（极快但功能少），Build 用 Rollup（功能全但较慢）
 * 4. HMR：文件变化 → WebSocket 通知 → 重新 import(?t=timestamp) → import.meta.hot.accept
 * 5. 插件系统兼容 Rollup 插件，额外提供 configureServer / handleHotUpdate 等 dev 钩子
 * 6. Import 路径重写：裸模块 → .vite/deps/ 预构建路径 + 版本 hash
 * 7. 未来方向：Rolldown（Rust 实现的 Rollup）统一 dev 和 build
 */

console.log("=== Vite 核心原理 — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "Dev 模式", key: "原生 ESM + 按需编译（Bundleless），浏览器请求模块 → 服务端即时编译 → 返回" },
  { name: "依赖预构建", key: "esbuild 将 node_modules 依赖打为单个 ESM 文件 → 缓存在 .vite/deps/" },
  { name: "HMR", key: "文件变化 → WebSocket 推送 → import(?t=xxx) 绕缓存 → import.meta.hot.accept" },
  { name: "生产构建", key: "用 Rollup（Tree Shaking + Code Splitting + CSS 提取）" },
  { name: "插件系统", key: "Rollup 插件超集 + configureServer/handleHotUpdate 等 Vite 特有钩子" },
  { name: "Import 路径重写", key: "裸模块 'react' → '/node_modules/.vite/deps/react.js?v=hash'" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
