/**
 * 微前端加载器 — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  微前端是什么
 * ═══════════════════════════════════════════════════════
 *
 * 微前端 = 将前端应用拆分为多个独立的小应用
 * 类比微服务：每个团队独立开发、独立部署、独立运行
 *
 * 核心问题：
 *   1. 应用加载：如何在主应用中加载子应用？
 *   2. JS 沙箱：子应用的全局变量如何隔离？
 *   3. CSS 隔离：子应用的样式如何不互相污染？
 *   4. 应用通信：子应用之间如何通信？
 *   5. 路由管理：URL 变化如何分发给正确的子应用？
 *
 * ═══════════════════════════════════════════════════════
 *  核心机制一：应用加载
 * ═══════════════════════════════════════════════════════
 *
 * single-spa / qiankun 的应用加载流程：
 *
 *   1. 注册子应用
 *      registerMicroApp({
 *        name: 'sub-app',
 *        entry: 'https://sub.example.com',  // HTML 入口
 *        container: '#subapp-container',
 *        activeRule: '/sub',                 // URL 匹配规则
 *      })
 *
 *   2. 路由匹配
 *      URL 变化 → 匹配 activeRule → 找到对应子应用
 *
 *   3. 加载子应用资源
 *      fetch(entry) → 解析 HTML → 提取 <script> 和 <link>
 *      下载 JS/CSS → 在沙箱中执行
 *
 *   4. 子应用生命周期
 *      bootstrap → mount → unmount → (可选) update
 *
 *      export async function bootstrap() { ... }
 *      export async function mount(props) {
 *        ReactDOM.render(<App />, props.container);
 *      }
 *      export async function unmount(props) {
 *        ReactDOM.unmountComponentAtNode(props.container);
 *      }
 *
 * ═══════════════════════════════════════════════════════
 *  核心机制二：JS 沙箱
 * ═══════════════════════════════════════════════════════
 *
 * 问题：子应用修改了 window.xxx → 影响主应用和其他子应用
 *
 * 【方案 1：快照沙箱（Snapshot Sandbox）】
 *   mount 时：遍历 window 所有属性 → 保存快照
 *   unmount 时：对比快照 → 恢复被修改的属性
 *   缺点：只支持单个子应用（因为恢复会影响其他子应用）
 *
 * 【方案 2：代理沙箱（Proxy Sandbox）】
 *   创建 fakeWindow = new Proxy({}, handler)
 *   子应用的代码在 fakeWindow 作用域下执行
 *   get → 先查 fakeWindow，没有再查真实 window
 *   set → 只写到 fakeWindow（不污染真实 window）
 *   支持多个子应用同时运行
 *
 *   实现要点（伪代码）：
 *   const fakeWindow = {};
 *   const proxy = new Proxy(fakeWindow, {
 *     get(target, key) {
 *       return target[key] ?? window[key];
 *     },
 *     set(target, key, value) {
 *       target[key] = value;  // 只修改 fakeWindow
 *       return true;
 *     }
 *   });
 *   // 用 with + eval 或 new Function 让子应用代码在 proxy 作用域下执行
 *   (function(window) { eval(subAppCode) })(proxy);
 *
 * ═══════════════════════════════════════════════════════
 *  核心机制三：CSS 隔离
 * ═══════════════════════════════════════════════════════
 *
 * 【方案 1：Shadow DOM】
 *   将子应用挂载到 Shadow DOM 中
 *   Shadow DOM 内的样式不会泄漏到外部
 *   问题：弹窗/浮层挂载到 document.body → 样式丢失
 *
 * 【方案 2：CSS Scoping（动态添加前缀）】
 *   子应用的所有 CSS 选择器加上唯一前缀
 *   .btn → .sub-app-1 .btn
 *   类似 Vue 的 scoped style
 *
 * 【方案 3：CSS Modules / CSS-in-JS】
 *   天然隔离（类名 hash 化），推荐
 *
 * ═══════════════════════════════════════════════════════
 *  核心机制四：应用通信
 * ═══════════════════════════════════════════════════════
 *
 * 【方案 1：全局状态（qiankun 的 initGlobalState）】
 *   主应用创建全局 state
 *   子应用通过 onGlobalStateChange 监听
 *   本质是 发布-订阅模式
 *
 * 【方案 2：CustomEvent】
 *   window.dispatchEvent(new CustomEvent('micro-event', { detail }))
 *   各应用通过 addEventListener 监听
 *
 * 【方案 3：URL 参数】
 *   最简单但有限制
 *
 * ═══════════════════════════════════════════════════════
 *  微前端方案对比
 * ═══════════════════════════════════════════════════════
 *
 *   方案           JS 隔离     CSS 隔离    通信       特点
 *   ──────────────────────────────────────────────────────
 *   qiankun       Proxy 沙箱  Shadow DOM  全局状态   最成熟
 *   micro-app     Proxy 沙箱  CSS scope   数据绑定   Web Component 方式
 *   Module Federation  无     无          Shared     构建时集成
 *   iframe        天然隔离    天然隔离    postMessage 最简单但体验差
 *   single-spa    无(需扩展)  无          自定义     底层框架
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. 微前端核心 = 应用加载 + JS 沙箱 + CSS 隔离 + 应用通信
 * 2. JS 沙箱：Proxy 代理 window → get 穿透、set 拦截 → 多实例隔离
 * 3. CSS 隔离：Shadow DOM（强隔离）/ CSS Scoping（加前缀）/ CSS Modules
 * 4. 子应用生命周期：bootstrap → mount → unmount，类似组件生命周期
 * 5. qiankun = single-spa + import-html-entry + sandbox + global state
 * 6. Module Federation 是构建时微前端（共享模块），qiankun 是运行时微前端
 * 7. iframe 隔离最好但体验差（弹窗/滚动/路由/性能）
 */

console.log("=== 微前端加载器 — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "应用加载", key: "fetch HTML → 提取 script/link → 沙箱中执行 → 生命周期管理" },
  { name: "JS 沙箱", key: "Proxy(fakeWindow): get 穿透到真实 window, set 拦截到 fakeWindow" },
  { name: "CSS 隔离", key: "Shadow DOM(强隔离) / CSS Scoping(加前缀) / CSS Modules(hash)" },
  { name: "应用通信", key: "全局状态(发布订阅) / CustomEvent / URL 参数" },
  { name: "生命周期", key: "bootstrap → mount(渲染) → unmount(销毁) → update(可选)" },
  { name: "qiankun", key: "single-spa + import-html-entry + Proxy sandbox + global state" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
