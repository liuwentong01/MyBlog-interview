/**
 * HMR 客户端 Runtime — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  HMR 客户端的职责
 * ═══════════════════════════════════════════════════════
 *
 * 你的 mini-devserver 已经实现了服务端 HMR。
 * 这里补充客户端 HMR Runtime 的核心逻辑。
 *
 * 客户端 Runtime 做什么？
 *   1. 建立 WebSocket 连接到 dev server
 *   2. 接收更新消息（哪些模块变了）
 *   3. 下载新模块代码
 *   4. 执行模块替换（不刷新页面）
 *   5. 调用 module.hot.accept 回调
 *
 * ═══════════════════════════════════════════════════════
 *  module.hot API（webpack 风格）
 * ═══════════════════════════════════════════════════════
 *
 * // 接受自身更新
 * module.hot.accept((newModule) => {
 *   // 模块代码已更新，这里做副作用处理
 *   render();
 * });
 *
 * // 接受依赖更新
 * module.hot.accept('./counter', () => {
 *   // counter.js 更新了，用新的值重新渲染
 *   const { count } = require('./counter');
 *   document.getElementById('count').textContent = count;
 * });
 *
 * // 清理副作用
 * module.hot.dispose((data) => {
 *   // 模块即将被替换，清理定时器/事件监听等
 *   clearInterval(timer);
 *   data.savedState = currentState; // 传递状态给新模块
 * });
 *
 * // 传递的状态在新模块中通过 module.hot.data 获取
 * const previousState = module.hot.data?.savedState;
 *
 * ═══════════════════════════════════════════════════════
 *  HMR 更新流程（客户端视角）
 * ═══════════════════════════════════════════════════════
 *
 * 1. WebSocket 收到消息：
 *    { type: "update", hash: "abc123", modules: ["./src/App.js"] }
 *
 * 2. 下载 hot-update 文件：
 *    GET /abc123.hot-update.json → { c: { "main": true } }
 *    GET /main.abc123.hot-update.js → 新模块代码（JSONP 格式）
 *
 * 3. 冒泡查找 accept 边界：
 *    ./src/App.js 变了
 *    → App.js 自己有 accept → ✓ 在这里应用更新
 *    → App.js 没有 accept → 看父模块（import App 的模块）
 *    → 一直冒泡到入口 → 还没有 accept → full reload
 *
 * 4. 执行更新：
 *    a. 调用旧模块的 dispose 回调（清理副作用）
 *    b. 删除旧模块缓存
 *    c. 执行新模块代码
 *    d. 调用 accept 回调
 *
 * ═══════════════════════════════════════════════════════
 *  冒泡（Bubble Up）机制
 * ═══════════════════════════════════════════════════════
 *
 * 模块依赖图：
 *   entry.js → App.js → Header.js
 *                     → Content.js → utils.js
 *
 * utils.js 变了：
 *   utils.js 有 accept? No
 *   → Content.js 有 accept('./utils')? Yes → 在 Content.js 应用更新
 *
 * Header.js 变了：
 *   Header.js 有 accept? No
 *   → App.js 有 accept('./Header')? No
 *   → entry.js 有 accept('./App')? No
 *   → 到达根节点 → full reload
 *
 * React Fast Refresh 的做法：
 *   React 组件自动有 accept（babel 插件注入）
 *   → 组件文件变了 → 自动应用更新 → 保留状态
 *
 * ═══════════════════════════════════════════════════════
 *  Vite 的 import.meta.hot（对比 webpack）
 * ═══════════════════════════════════════════════════════
 *
 * Vite 用 import.meta.hot（ESM 标准）替代 module.hot：
 *
 *   if (import.meta.hot) {
 *     import.meta.hot.accept((newModule) => {
 *       // 自身更新
 *     });
 *
 *     import.meta.hot.accept(['./dep'], ([newDep]) => {
 *       // 依赖更新
 *     });
 *
 *     import.meta.hot.dispose((data) => {
 *       // 清理
 *     });
 *
 *     import.meta.hot.invalidate();  // 强制向上冒泡
 *   }
 *
 * Vite HMR 的实现更简单：
 *   - 不需要 JSONP，直接 import() 加载新模块（ESM 天然支持）
 *   - URL 加 ?t=timestamp 绕过浏览器缓存
 *   - WebSocket 消息格式更简洁
 *
 * ═══════════════════════════════════════════════════════
 *  CSS HMR
 * ═══════════════════════════════════════════════════════
 *
 * CSS 的 HMR 比 JS 简单得多：
 *   1. 收到 CSS 更新消息
 *   2. 找到对应的 <style> 标签或 <link> 标签
 *   3. 替换内容（<style>）或更新 href（<link>?t=timestamp）
 *   4. 浏览器自动重排重绘
 *
 * 不需要 accept/dispose 机制 → CSS 没有副作用
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. HMR 客户端 = WebSocket 监听 + 下载新模块 + 冒泡查找 accept + 执行替换
 * 2. accept 机制：模块声明"我能处理更新" → 阻止冒泡 → 局部刷新
 * 3. dispose 清理副作用（定时器/事件监听），通过 data 传递状态给新模块
 * 4. 无 accept 冒泡到根 → full reload（这就是为什么需要 React Fast Refresh 插件）
 * 5. React Fast Refresh：babel 插件自动注入 accept → 组件文件 HMR + 保持状态
 * 6. Vite 用 import.meta.hot + 原生 ESM import() 替代 webpack 的 JSONP 方案
 * 7. CSS HMR 简单：替换 <style> 内容或 <link> href → 无副作用问题
 */

console.log("=== HMR 客户端 Runtime — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "accept 机制", key: "模块声明能处理更新 → 阻止冒泡 → 局部替换不刷新页面" },
  { name: "冒泡查找", key: "变化模块无 accept → 沿依赖图向上找 → 到根则 full reload" },
  { name: "dispose 清理", key: "替换前清理副作用(timer/listener) → data 传递状态给新模块" },
  { name: "React Fast Refresh", key: "babel 插件自动注入 accept → 组件 HMR + 保持 state" },
  { name: "Vite vs Webpack", key: "import.meta.hot + ESM import() vs module.hot + JSONP" },
  { name: "CSS HMR", key: "替换 <style>/<link href> → 简单，无副作用" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
