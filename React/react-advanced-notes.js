/**
 * React 进阶概念笔记（第三梯队 P2）— 仅注释，不实现代码
 *
 * 这些概念在面试中出现频率相对较低，但理解它们有助于深入掌握 React 架构。
 * 每个主题包含：核心原理、关键实现思路、面试常见问法。
 *
 * 目录：
 *   1. React.lazy + Suspense（懒加载 + 异步边界）
 *   2. ErrorBoundary（错误边界）
 *   3. React Server Components（RSC）
 *   4. useTransition / useDeferredValue（并发特性）
 *   5. Fiber 树遍历（DFS 遍历算法）
 *   6. Hydration（服务端渲染注水）
 *
 * 运行方式：node React/react-advanced-notes.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、React.lazy + Suspense
// ═══════════════════════════════════════════════════════════════════════════
//
// 【是什么】
//   React.lazy 实现组件的代码分割（Code Splitting），
//   Suspense 提供异步加载的等待边界（fallback UI）。
//
// 【核心原理】
//   React.lazy 本质上是一个 "thenable" 包装器：
//
//   1. lazy(importFn) 返回一个特殊组件对象：
//      { $$typeof: REACT_LAZY_TYPE, _payload: { _status, _result }, _init }
//
//   2. 首次渲染时，_status = Uninitialized(-1)
//      调用 importFn()（即 import('./MyComponent')）得到 Promise
//      _status 变为 Pending(0)
//
//   3. React 在 render 阶段遇到 Pending 状态 → throw thenable（抛出 Promise）
//      这就是 Suspense 的核心机制：用 throw 中断渲染！
//
//   4. Suspense 组件在 render 中用 try/catch 捕获这个 thrown Promise
//      捕获后：显示 fallback UI，并订阅 Promise 的 resolve
//
//   5. Promise resolve 后，_status 变为 Resolved(1)，_result = 模块的 default export
//      React 重新渲染 → lazy 组件正常返回 → 替换 fallback 为真实内容
//
// 【关键实现思路（伪代码）】
//
//   function lazy(importFn) {
//     const payload = { _status: -1, _result: importFn };
//     return {
//       $$typeof: REACT_LAZY_TYPE,
//       _payload: payload,
//       _init(payload) {
//         if (payload._status === -1) {
//           const promise = payload._result();     // 调用 import()
//           payload._status = 0;                   // Pending
//           payload._result = promise;
//           promise.then(
//             module => { payload._status = 1; payload._result = module; },
//             error  => { payload._status = 2; payload._result = error; }
//           );
//         }
//         if (payload._status === 1) return payload._result.default;
//         throw payload._result;  // Pending → throw Promise → Suspense 捕获
//       }
//     };
//   }
//
// 【Suspense 的 catch 机制】
//
//   Suspense 组件在 Fiber 树中充当 "异步边界"：
//   - 子树 render 时 throw promise → 往上冒泡到最近的 Suspense
//   - Suspense 记录这个 promise，渲染 fallback
//   - promise resolve → 重新尝试渲染子树
//   - 可以嵌套：内层 Suspense 优先捕获
//
//   React 18 中 Suspense 还支持：
//   - SuspenseList（控制多个 Suspense 的显示顺序）
//   - Streaming SSR（服务端流式渲染配合 Suspense 边界）
//
// 【面试常见问法】
//   Q: React.lazy 的原理是什么？
//   A: 首次渲染时调用 import() 得到 Promise，通过 throw Promise 中断渲染，
//      Suspense 捕获后显示 fallback，Promise resolve 后重新渲染显示真实组件。
//
//   Q: 为什么 Suspense 能"暂停"渲染？
//   A: 不是真正暂停，而是 throw promise → try/catch 捕获 → 切换到 fallback 分支。
//      这利用了 JavaScript 的异常控制流（类似代数效应 Algebraic Effects）。
//
//   Q: React.lazy 只能用于路由级别吗？
//   A: 不是，任何组件都可以 lazy 化，但通常用于路由级别效果最明显。


// ═══════════════════════════════════════════════════════════════════════════
// 二、ErrorBoundary — 错误边界
// ═══════════════════════════════════════════════════════════════════════════
//
// 【是什么】
//   ErrorBoundary 是能捕获子组件树渲染/生命周期中 JavaScript 错误的 Class 组件。
//   防止整个应用因为某个组件的错误而白屏。
//
// 【核心原理】
//
//   1. ErrorBoundary 是通过两个生命周期实现的：
//      - static getDerivedStateFromError(error)：render 阶段调用
//        返回新 state → 用于切换到错误 UI
//      - componentDidCatch(error, errorInfo)：commit 阶段调用
//        用于上报错误日志（副作用）
//
//   2. React 在 renderRootSync/renderRootConcurrent 中，
//      如果子 Fiber 的 render 抛出错误：
//      - 从当前 Fiber 向上遍历（throwException）
//      - 找到最近的 ErrorBoundary（有 getDerivedStateFromError 的组件）
//      - 在该 Fiber 上标记 ShouldCapture flag
//      - 重新从 ErrorBoundary 开始渲染（使用错误状态）
//
//   3. ErrorBoundary 不能捕获的错误：
//      - 事件处理函数中的错误（用普通 try/catch）
//      - 异步代码（setTimeout、Promise）
//      - SSR 中的错误
//      - ErrorBoundary 自身的错误
//
// 【关键实现思路（伪代码）】
//
//   class ErrorBoundary extends React.Component {
//     state = { hasError: false, error: null };
//
//     static getDerivedStateFromError(error) {
//       // render 阶段：返回新 state 以切换到错误 UI
//       return { hasError: true, error };
//     }
//
//     componentDidCatch(error, errorInfo) {
//       // commit 阶段：上报错误
//       logErrorToService(error, errorInfo.componentStack);
//     }
//
//     render() {
//       if (this.state.hasError) {
//         return <FallbackUI error={this.state.error} />;
//       }
//       return this.props.children;
//     }
//   }
//
// 【与 Suspense 的关系】
//
//   ErrorBoundary 和 Suspense 的机制非常相似：
//   - Suspense：子树 throw promise → 捕获 → 显示 fallback → resolve 后重渲染
//   - ErrorBoundary：子树 throw error → 捕获 → 显示错误 UI
//   - 两者都是通过 throw + 向上查找边界组件实现的
//   - React 内部统一在 throwException 函数中处理
//
// 【为什么只能是 Class 组件？】
//   因为 getDerivedStateFromError 和 componentDidCatch 是 Class 生命周期。
//   截至 React 19，还没有对应的 Hook。社区通常用 react-error-boundary 库封装。
//
// 【面试常见问法】
//   Q: ErrorBoundary 的原理？
//   A: 利用 getDerivedStateFromError（render 阶段切换状态）和
//      componentDidCatch（commit 阶段上报），通过 React 内部的
//      throwException 机制向上查找最近的错误边界。
//
//   Q: 为什么事件处理函数的错误捕获不到？
//   A: 事件回调不在 React 的 render/commit 流程中执行，
//      是异步的用户代码，不经过 React 的 try/catch 包装。


// ═══════════════════════════════════════════════════════════════════════════
// 三、React Server Components（RSC）
// ═══════════════════════════════════════════════════════════════════════════
//
// 【是什么】
//   RSC 是在服务端执行的 React 组件，不会发送组件代码到客户端。
//   与 SSR 不同：SSR 是在服务端渲染 HTML，RSC 是在服务端渲染组件树（React 树）。
//
// 【核心区别：RSC vs SSR vs CSR】
//
//   CSR（Client Side Rendering）：
//     浏览器下载 JS → 执行 React → 渲染 DOM
//     首屏白屏时间长，JS bundle 大
//
//   SSR（Server Side Rendering）：
//     服务端执行 React → 生成 HTML 字符串 → 发送到客户端 → hydrate
//     首屏快，但组件代码仍然全部发送到客户端（用于 hydration）
//
//   RSC（React Server Components）：
//     服务端执行组件 → 生成序列化的 React 树（不是 HTML）→ 流式发送
//     Server Component 的代码永远不发送到客户端（零 JS 成本）
//     可以直接访问数据库、文件系统（因为在服务端执行）
//
// 【三种组件类型】
//
//   1. Server Component（默认，无 "use client" 标记）
//      - 只在服务端执行，不发送 JS 到客户端
//      - 可以 async/await（直接读数据库）
//      - 不能用 state、effect、事件处理（因为不在浏览器中）
//      - 可以 import Server Component 或 Client Component
//
//   2. Client Component（标记 "use client"）
//      - 在客户端执行（也可能 SSR 预渲染）
//      - 可以用 state、effect、事件处理
//      - 只能 import Client Component（不能 import Server Component）
//      - 但可以通过 children/props 接收 Server Component 的渲染结果
//
//   3. Shared Component
//      - 两端都可以运行（纯展示组件，无 state 无副作用）
//
// 【RSC 协议（RSC Wire Format）】
//
//   服务端不是生成 HTML，而是生成一种特殊的序列化格式：
//
//   M1:{"id":"./Counter.js","name":"Counter","chunks":["chunk-abc"]}
//   J0:["$","div",null,{"children":[
//     ["$","h1",null,{"children":"Hello"}],
//     ["$","$L1",null,{"initialCount":0}]
//   ]}]
//
//   - J 行 = 序列化的 React 元素树（Server Component 已被求值）
//   - M 行 = Client Component 的模块引用（告诉客户端去加载哪个 JS）
//   - $L1 = 引用 M1 定义的 Client Component（懒加载）
//
//   客户端收到后：
//   - Server Component 部分直接渲染（已经是求值后的树）
//   - Client Component 部分根据 M 行加载对应的 JS chunk → hydrate
//
// 【核心优势】
//   1. 零 JS bundle：Server Component 代码不发送到客户端
//   2. 直接数据访问：组件内直接 await db.query()，无需 API 层
//   3. 自动代码分割：Client Component 自动按需加载
//   4. 流式渲染：配合 Suspense，逐步发送 RSC 数据
//
// 【面试常见问法】
//   Q: RSC 和 SSR 的区别？
//   A: SSR 在服务端生成 HTML 字符串，组件 JS 仍全部发送到客户端做 hydration。
//      RSC 在服务端生成序列化的 React 树，Server Component 的 JS 永远不发送到客户端。
//      SSR 优化首屏速度，RSC 优化 bundle 大小 + 数据获取。两者可以组合使用。
//
//   Q: 为什么 Server Component 不能用 useState？
//   A: Server Component 在服务端执行完就销毁了，没有"组件实例"驻留，
//      不存在重渲染的概念，所以 state 没有意义。交互逻辑必须在 Client Component 中。


// ═══════════════════════════════════════════════════════════════════════════
// 四、useTransition / useDeferredValue — 并发特性
// ═══════════════════════════════════════════════════════════════════════════
//
// 【是什么】
//   React 18 的并发特性：允许将某些状态更新标记为"非紧急"，
//   让紧急更新（输入、点击）优先渲染，非紧急更新（列表过滤、搜索结果）延后。
//
// 【useTransition】
//
//   const [isPending, startTransition] = useTransition();
//
//   原理：
//   1. startTransition 内部的 setState 会被标记为 "Transition" 优先级（最低）
//   2. React 的调度器会先处理高优先级更新（用户输入），再处理 Transition 更新
//   3. 如果 Transition 渲染过程中有新的高优先级更新进来 → 中断 Transition，先处理高优
//   4. isPending = true 表示 Transition 更新还没完成（可以显示 loading 状态）
//
//   实现要点：
//   - startTransition 设置全局的 ReactCurrentBatchConfig.transition = {}
//   - 在 setState 时检查 transition 标记 → 赋予 TransitionLane（低优先级 lane）
//   - Scheduler 按 lane 优先级调度：SyncLane > InputContinuousLane > DefaultLane > TransitionLane
//   - isPending 通过 useOptimisticState 或内部 state 实现
//
//   使用场景：
//   - 搜索输入框：输入是紧急的（立即更新输入框），搜索结果是非紧急的（可延迟）
//   - Tab 切换：切换标记是紧急的，内容渲染是非紧急的
//   - 大列表过滤：过滤条件输入是紧急的，过滤结果渲染可延迟
//
//   function SearchPage() {
//     const [input, setInput] = useState('');
//     const [results, setResults] = useState([]);
//     const [isPending, startTransition] = useTransition();
//
//     function handleChange(e) {
//       setInput(e.target.value);           // 紧急：立即更新输入框
//       startTransition(() => {
//         setResults(filterData(e.target.value)); // 非紧急：可中断、可延迟
//       });
//     }
//
//     return (
//       <>
//         <input value={input} onChange={handleChange} />
//         {isPending ? <Spinner /> : <ResultList data={results} />}
//       </>
//     );
//   }
//
// 【useDeferredValue】
//
//   const deferredValue = useDeferredValue(value);
//
//   原理：
//   1. 内部相当于：在 useEffect 中用 startTransition 更新一个 state
//   2. value 变化时，deferredValue 不会立即跟着变
//   3. 等高优先级更新完成后，deferredValue 才更新为最新值
//   4. 可以配合 React.memo 使用：deferredValue 没变 → 子组件跳过渲染
//
//   与 useTransition 的区别：
//   - useTransition：包裹 setState 调用（你控制哪个更新是低优先级）
//   - useDeferredValue：包裹值（React 自动将依赖这个值的更新降为低优先级）
//   - useDeferredValue 适合无法控制 setState 的场景（如 props 传来的值）
//
// 【底层机制：Lane 优先级 + 时间切片】
//
//   React 18 的并发渲染靠两个机制：
//
//   1. Lane 模型（优先级）：
//      每个更新有一个 lane（二进制位），值越小优先级越高
//      SyncLane(1) > InputContinuousLane(4) > DefaultLane(16) > TransitionLane(64...)
//      多个更新可以合并（位运算 OR）
//
//   2. 时间切片（可中断渲染）：
//      workLoopConcurrent 中每处理一个 Fiber 就检查 shouldYield()
//      超时（5ms）就让出主线程 → 浏览器可以处理用户输入
//      下次拿回控制权时继续（或者有更高优先级就中断重来）
//
// 【面试常见问法】
//   Q: useTransition 和防抖/节流有什么区别？
//   A: 防抖/节流是延迟执行（丢弃中间值），useTransition 是降低优先级（每次都执行，但可中断）。
//      useTransition 不会丢失任何更新，只是让紧急更新先完成。
//      防抖有固定延迟，useTransition 会尽快完成（CPU 空闲时立即执行）。
//
//   Q: 并发模式下 setState 还是同步的吗？
//   A: React 18 默认所有 setState 都是批量更新（automatic batching）。
//      但"同步/异步"不是关键，关键是"优先级"：
//      startTransition 内的更新优先级低，可以被高优先级更新打断。


// ═══════════════════════════════════════════════════════════════════════════
// 五、Fiber 树遍历（DFS 深度优先遍历）
// ═══════════════════════════════════════════════════════════════════════════
//
// 【是什么】
//   React 的 render 阶段就是对 Fiber 树做深度优先遍历（DFS）。
//   每个 Fiber 节点经历两个阶段：beginWork（向下）和 completeWork（向上）。
//
// 【Fiber 节点的链表结构】
//
//   每个 Fiber 有三个指针（不是传统的 children 数组！）：
//     fiber.child    → 第一个子节点
//     fiber.sibling  → 下一个兄弟节点
//     fiber.return   → 父节点
//
//   示例：
//     <div>           div.child → h1
//       <h1/>         h1.sibling → p       h1.return → div
//       <p/>          p.sibling → span      p.return → div
//       <span/>       span.sibling → null   span.return → div
//     </div>
//
//   为什么用链表而不是数组？
//   - 链表可以在任意位置暂停和恢复（时间切片的基础）
//   - 遍历不需要递归（不占用调用栈），完全用 while 循环
//   - 方便在遍历过程中插入/删除节点
//
// 【遍历算法：workLoopSync / workLoopConcurrent】
//
//   整体流程是一个 DFS：
//
//   function workLoopSync() {
//     while (workInProgress !== null) {
//       performUnitOfWork(workInProgress);
//     }
//   }
//
//   function performUnitOfWork(unitOfWork) {
//     // 1. beginWork：处理当前节点，返回 child
//     const next = beginWork(unitOfWork);
//
//     if (next !== null) {
//       // 有子节点 → 继续向下
//       workInProgress = next;
//     } else {
//       // 没有子节点 → completeUnitOfWork
//       completeUnitOfWork(unitOfWork);
//     }
//   }
//
//   function completeUnitOfWork(unitOfWork) {
//     let node = unitOfWork;
//     while (node !== null) {
//       // 2. completeWork：创建/更新 DOM，收集 effectList
//       completeWork(node);
//
//       // 有兄弟 → 对兄弟执行 beginWork
//       if (node.sibling !== null) {
//         workInProgress = node.sibling;
//         return;
//       }
//       // 没有兄弟 → 回到父节点继续 complete
//       node = node.return;
//     }
//     workInProgress = null; // 遍历完成
//   }
//
// 【遍历顺序示例】
//
//   Fiber 树：
//       App
//      / \
//    div   Footer
//    / \
//   h1  p
//
//   遍历顺序（↓ = beginWork, ↑ = completeWork）：
//
//   ↓ App → ↓ div → ↓ h1
//   ↑ h1（无 child）→ sibling → ↓ p
//   ↑ p（无 child，无 sibling）→ ↑ div → sibling → ↓ Footer
//   ↑ Footer → ↑ App
//
//   beginWork 顺序: App → div → h1 → p → Footer
//   completeWork 顺序: h1 → p → div → Footer → App
//
// 【beginWork 做什么】
//   - 根据 fiber.tag（FunctionComponent/HostComponent/...）分别处理
//   - 函数组件：执行函数，得到 children（此时执行 Hooks）
//   - Host 组件（div/span）：处理 props diff
//   - 创建子 Fiber（reconcileChildren，即 diff 算法）
//   - 返回 child Fiber
//
// 【completeWork 做什么】
//   - Host 组件：创建真实 DOM 节点（或标记更新）
//   - 收集 flags（Insert/Update/Delete）到 effectList
//   - 冒泡子树的 subtreeFlags（用于 commit 阶段快速定位有变化的节点）
//
// 【面试常见问法】
//   Q: React 的 Fiber 遍历是怎样的？为什么可以中断？
//   A: Fiber 树用 child/sibling/return 三指针链表表示，用 while 循环做 DFS。
//      每处理一个节点就是一个"工作单元"，循环中可以检查是否需要让出（shouldYield）。
//      因为不用递归，没有调用栈的限制，可以在任意节点暂停，下次从 workInProgress 继续。
//
//   Q: beginWork 和 completeWork 的区别？
//   A: beginWork 是"向下"阶段：处理组件逻辑、执行 hooks、创建子 Fiber（diff）。
//      completeWork 是"向上"阶段：创建 DOM、收集 effectList。
//      类似于树的前序遍历（begin）和后序遍历（complete）。


// ═══════════════════════════════════════════════════════════════════════════
// 六、Hydration — 服务端渲染注水
// ═══════════════════════════════════════════════════════════════════════════
//
// 【是什么】
//   Hydration 是将服务端渲染（SSR）生成的静态 HTML "注入"交互能力的过程。
//   服务端生成 HTML → 浏览器显示（快速首屏）→ JS 加载后 hydrate → 页面变得可交互。
//
// 【SSR + Hydration 完整流程】
//
//   服务端：
//     1. renderToString(<App />) → 生成 HTML 字符串
//     2. 发送 HTML + JS bundle 到客户端
//
//   客户端：
//     1. 浏览器解析 HTML → 立即显示页面（FCP 快）
//     2. JS 下载完成 → 执行 React
//     3. hydrateRoot(container, <App />)：
//        a. React 构建 Fiber 树（和首次渲染一样）
//        b. 但不创建新 DOM，而是"认领"已有 DOM
//        c. 遍历 Fiber 树，给每个 DOM 节点绑定事件
//        d. 执行 useEffect 等副作用
//     4. 页面变得可交互（TTI）
//
// 【Hydration 的核心：复用 DOM 而非重新创建】
//
//   普通 render（createRoot）：
//     Fiber → 创建 DOM 节点 → 插入到容器中
//
//   hydrate（hydrateRoot）：
//     Fiber → 查找容器中已有的 DOM 节点 → 建立 Fiber ↔ DOM 的关联
//     → 绑定事件 → 校验 HTML 是否匹配
//
//   具体匹配过程：
//   - 用一个游标（cursor）按顺序遍历已有的 DOM 子节点
//   - 每个 Fiber 的 beginWork 阶段，尝试匹配下一个 DOM 节点
//   - 匹配条件：标签名相同（div === div）、文本内容相同
//   - 匹配成功：fiber.stateNode = existingDOM（复用）
//   - 匹配失败：报 hydration mismatch 警告，降级为客户端渲染
//
// 【Hydration Mismatch — 常见坑】
//
//   当服务端和客户端渲染结果不一致时，会产生 mismatch：
//
//   常见原因：
//   1. 使用了 Date.now()、Math.random()（服务端和客户端值不同）
//   2. 判断 typeof window !== 'undefined'（服务端为 true，客户端也为 true，但时机不同）
//   3. 浏览器自动补全的 HTML（如 <table> 自动加 <tbody>）
//   4. 第三方脚本修改了 DOM
//
//   React 的处理：
//   - React 16：静默忽略（可能导致 UI 错乱）
//   - React 18：控制台警告 + 尝试恢复（严重时整个子树重新渲染）
//   - 可以用 suppressHydrationWarning 属性压制特定节点的警告
//
// 【React 18 的选择性 Hydration（Selective Hydration）】
//
//   传统 Hydration 的问题：
//   - 必须等所有 JS 加载完才能开始 hydrate
//   - hydrate 是同步的，大页面会阻塞主线程
//   - 用户必须等整个页面 hydrate 完才能交互
//
//   React 18 解决方案（配合 Suspense）：
//
//   1. 流式 SSR（Streaming SSR）：
//      不等整个页面渲染完，边渲染边发送 HTML
//      <Suspense> 边界内的内容可以稍后补充
//
//   2. 选择性 Hydration：
//      <Suspense> 包裹的区域可以独立 hydrate
//      不用等所有 JS 加载完 → 已加载的部分先 hydrate
//
//   3. 用户交互优先：
//      如果用户点击了还没 hydrate 的区域
//      React 会优先 hydrate 该区域（提升其优先级）
//
//   示例：
//     <Layout>
//       <NavBar />                    ← 最先 hydrate
//       <Suspense fallback={<Spinner />}>
//         <MainContent />             ← JS 加载完后 hydrate
//       </Suspense>
//       <Suspense fallback={<Spinner />}>
//         <Comments />                ← 最后 hydrate（或用户点击时优先）
//       </Suspense>
//     </Layout>
//
// 【renderToString vs renderToPipeableStream】
//
//   React 16-17（renderToString）：
//   - 同步渲染整个页面为 HTML 字符串
//   - 必须等所有数据就绪
//   - 不支持 Suspense
//
//   React 18（renderToPipeableStream）：
//   - 流式渲染：先发送已就绪的 HTML，Suspense 边界内的稍后补充
//   - 支持 Suspense：fallback 先渲染，resolve 后通过 <script> 注入替换
//   - 配合 Selective Hydration 实现渐进式页面可交互
//
// 【面试常见问法】
//   Q: hydration 是什么？和 render 有什么区别？
//   A: hydration 复用服务端生成的 DOM，给它绑定事件和 React 状态。
//      render 是从零创建 DOM。hydration 不创建新 DOM，只做匹配和绑定。
//
//   Q: hydration mismatch 是什么？怎么避免？
//   A: 服务端和客户端渲染结果不一致。避免方法：不在首次渲染中使用
//      Date.now()、window 判断等两端不一致的逻辑。可以用 useEffect
//      在客户端 mount 后再执行这些逻辑。
//
//   Q: React 18 的 Selective Hydration 是什么？
//   A: 配合 Suspense 实现分区 hydration：已加载 JS 的部分先 hydrate，
//      未加载的显示 fallback。用户交互的区域优先 hydrate。
//      解决了传统 hydration "全量等待"的问题。


// ═══════════════════════════════════════════════════════════════════════════
// 总结
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== React 进阶概念笔记（P2 第三梯队）===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  {
    name: "React.lazy + Suspense",
    key: "throw Promise 中断渲染 → Suspense 捕获 → fallback → resolve 后重渲染",
  },
  {
    name: "ErrorBoundary",
    key: "getDerivedStateFromError(render阶段) + componentDidCatch(commit阶段) → 向上查找边界",
  },
  {
    name: "React Server Components",
    key: "服务端执行组件 → 序列化 React 树（非 HTML）→ Server Component JS 永不发送到客户端",
  },
  {
    name: "useTransition / useDeferredValue",
    key: "标记非紧急更新 → Lane 低优先级 → 可中断 → 紧急更新优先渲染",
  },
  {
    name: "Fiber 树遍历",
    key: "child/sibling/return 链表 + while 循环 DFS → beginWork(向下) + completeWork(向上)",
  },
  {
    name: "Hydration",
    key: "复用 SSR 的 DOM → 匹配 Fiber ↔ DOM → 绑定事件 → React 18 Selective Hydration",
  },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     核心: ${t.key}\n`);
});

console.log("\n=== 面试要点总览 ===");
console.log("1. React.lazy 通过 throw Promise 实现异步加载，Suspense 用 try/catch 捕获");
console.log("2. ErrorBoundary 只能捕获 render/commit 阶段的错误，事件/异步错误用 try/catch");
console.log("3. RSC 在服务端执行组件，生成序列化 React 树，组件 JS 不发送到客户端（vs SSR 全量发送）");
console.log("4. useTransition 降低更新优先级（Lane），让紧急更新先完成，不丢失更新（vs 防抖丢弃）");
console.log("5. Fiber 树用链表结构 + while 循环遍历，无调用栈限制 → 可在任意节点暂停（时间切片基础）");
console.log("6. Hydration 复用 SSR DOM + 绑定事件，React 18 支持 Selective Hydration（Suspense 分区）");
