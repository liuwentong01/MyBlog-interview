/**
 * React Hooks 完整实现 — useReducer / useMemo / useCallback / useRef / useContext
 *
 * ═══════════════════════════════════════════════════════
 *  Hooks 的底层机制
 * ═══════════════════════════════════════════════════════
 *
 * 所有 Hooks 都挂在 Fiber 节点的 memoizedState 上，以单链表形式存储：
 *
 *   fiber.memoizedState → hook1 → hook2 → hook3 → null
 *                          ↑ useState   ↑ useEffect  ↑ useMemo
 *
 * 每次组件渲染时，按调用顺序依次读取链表中的 hook：
 *   - 首次渲染（mount）：创建 hook 节点，追加到链表
 *   - 更新渲染（update）：按顺序读取已有的 hook 节点
 *
 * 这就是为什么 Hooks 不能放在条件/循环中——
 * 如果调用顺序变了，链表的对应关系就错位了。
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. useState     — 状态管理（底层就是 useReducer）
 *  2. useReducer   — 通过 reducer 管理复杂状态
 *  3. useMemo      — 缓存计算结果
 *  4. useCallback  — 缓存函数引用（useMemo 的语法糖）
 *  5. useRef       — 跨渲染持久化引用
 *  6. useContext   — 消费 Context 的值
 *
 * 运行方式：node React/mini-hooks.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 模拟 Fiber + Hook 链表
// ═══════════════════════════════════════════════════════════════════════════

let currentFiber = null;     // 当前正在渲染的 Fiber
let hookIndex = 0;           // 当前 hook 在链表中的位置
let isMount = true;          // 是否是首次渲染
let scheduleRerender = null; // 重渲染调度函数

// 模拟 Fiber 节点
function createFiberNode() {
  return {
    memoizedState: null, // hook 链表头
    hooks: [],           // 简化：用数组代替链表（便于理解）
  };
}

// 获取当前 hook（mount 时创建，update 时读取）
function getHook() {
  let hook;
  if (isMount) {
    // 首次渲染：创建新 hook
    hook = {
      memoizedState: null, // hook 自己的状态
      queue: [],           // 待处理的更新队列（用于 useState/useReducer）
    };
    currentFiber.hooks.push(hook);
  } else {
    // 更新渲染：按序读取已有 hook
    hook = currentFiber.hooks[hookIndex];
  }
  hookIndex++;
  return hook;
}

// ═══════════════════════════════════════════════════════════════════════════
// 一、useReducer
// ═══════════════════════════════════════════════════════════════════════════
//
// useReducer(reducer, initialState) → [state, dispatch]
//
// 与 useState 的关系：
//   useState 底层就是 useReducer，只是用了一个内置的 basicStateReducer：
//   (state, action) => typeof action === 'function' ? action(state) : action
//
// dispatch 的工作流程：
//   1. 把 action 推入 hook 的更新队列
//   2. 触发组件重渲染
//   3. 重渲染时依次执行队列中的 action，计算新 state

function useReducer(reducer, initialState) {
  const hook = getHook();

  if (isMount) {
    hook.memoizedState = initialState;
  }

  // 处理更新队列（在渲染阶段执行）
  // 遍历 queue 中积累的 action，依次调用 reducer
  hook.queue.forEach((action) => {
    hook.memoizedState = reducer(hook.memoizedState, action);
  });
  hook.queue = []; // 清空已处理的队列

  // dispatch：把 action 推入队列 + 调度重渲染
  const dispatch = (action) => {
    hook.queue.push(action);
    // 调度重渲染（真实 React 中会走 scheduleUpdateOnFiber）
    if (scheduleRerender) scheduleRerender();
  };

  return [hook.memoizedState, dispatch];
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、useState
// ═══════════════════════════════════════════════════════════════════════════
//
// useState 就是 useReducer 的特化版本
// reducer 很简单：新值替换旧值（如果传入函数则执行函数）

function useState(initialState) {
  // 内置的 reducer：
  // 如果 action 是函数 → 执行它（函数式更新: setState(prev => prev + 1)）
  // 如果 action 是值   → 直接替换
  return useReducer(
    (state, action) => (typeof action === "function" ? action(state) : action),
    initialState
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、useMemo
// ═══════════════════════════════════════════════════════════════════════════
//
// useMemo(factory, deps) → cachedValue
//
// 原理：
//   1. 首次渲染：执行 factory()，缓存结果和 deps
//   2. 后续渲染：比较新旧 deps（浅比较每一项）
//      - 相同 → 返回缓存值（跳过计算）
//      - 不同 → 重新执行 factory()，更新缓存
//
// 面试追问：useMemo 的 deps 是怎么比较的？
//   逐项用 Object.is() 比较（=== 但 NaN === NaN 为 true）
//   所以 deps 中放对象/数组时要小心——每次渲染都是新引用 → deps 永远"变了"

function useMemo(factory, deps) {
  const hook = getHook();

  if (isMount) {
    // 首次渲染：执行 factory，缓存结果
    const value = factory();
    hook.memoizedState = [value, deps];
    return value;
  }

  const [prevValue, prevDeps] = hook.memoizedState;

  // 比较 deps 是否变化
  if (deps && prevDeps && depsEqual(deps, prevDeps)) {
    // deps 没变 → 返回缓存值
    return prevValue;
  }

  // deps 变了 → 重新计算
  const value = factory();
  hook.memoizedState = [value, deps];
  return value;
}

// deps 浅比较
function depsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // React 用的是 Object.is，和 === 的区别：
    // Object.is(NaN, NaN) → true（=== 为 false）
    // Object.is(+0, -0) → false（=== 为 true）
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、useCallback
// ═══════════════════════════════════════════════════════════════════════════
//
// useCallback(fn, deps) 等价于 useMemo(() => fn, deps)
//
// useMemo 缓存的是"计算结果"
// useCallback 缓存的是"函数本身"
//
// 使用场景：
//   把回调传给子组件时，配合 React.memo 避免子组件不必要的重渲染
//   如果不用 useCallback，每次父组件渲染都会创建新函数引用
//   → 子组件的 props 引用变了 → React.memo 浅比较失败 → 子组件重渲染

function useCallback(fn, deps) {
  return useMemo(() => fn, deps);
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、useRef
// ═══════════════════════════════════════════════════════════════════════════
//
// useRef(initialValue) → { current: initialValue }
//
// 特点：
//   1. 返回的对象引用在整个生命周期内保持不变
//   2. 修改 .current 不会触发重渲染（和 state 的核心区别）
//   3. 总是拿到最新值（不像 state 有闭包陷阱）
//
// 常见用途：
//   - 保存 DOM 引用：<div ref={myRef}> → myRef.current 是 DOM 节点
//   - 保存上一次渲染的值
//   - 保存定时器 ID
//   - 在 useEffect/回调中访问最新的 props/state（规避闭包陷阱）
//
// 实现极其简单——就是一个不触发重渲染的持久化容器

function useRef(initialValue) {
  const hook = getHook();

  if (isMount) {
    // 创建 ref 对象，后续渲染直接返回同一个对象
    hook.memoizedState = { current: initialValue };
  }

  return hook.memoizedState;
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、useContext + createContext
// ═══════════════════════════════════════════════════════════════════════════
//
// Context 解决的问题：
//   组件树很深时，避免层层传递 props（prop drilling）
//   Provider 在顶层提供值，任意后代组件都能直接消费
//
// 核心原理：
//   - createContext 创建一个 Context 对象，持有当前值
//   - Provider 组件设置 Context 的值
//   - useContext 从 Context 对象中读取当前值
//
// 面试重点：Context 的性能问题
//   Provider 的 value 变化时，所有调用 useContext 的组件都会重渲染
//   即使组件只用了 Context 中的一部分属性！
//   这就是为什么大型应用倾向于用 Redux/Zustand 而不是纯 Context

function createContext(defaultValue) {
  const context = {
    _currentValue: defaultValue,

    // Provider 组件：设置 Context 值，渲染 children
    Provider: function ({ value, children }) {
      context._currentValue = value;
      // 真实 React 中：
      // 1. 比较新旧 value（Object.is）
      // 2. 变了 → 遍历 Fiber 子树，找到所有消费此 Context 的组件
      // 3. 标记这些组件需要重渲染
      return children;
    },
  };

  return context;
}

function useContext(context) {
  // 直接读取 Context 的当前值
  // 真实 React 中：
  // 1. 在 Fiber 上记录"当前组件依赖此 Context"
  // 2. Provider value 变化时，React 沿 Fiber 树向下搜索消费者
  // 3. 匹配到的消费者标记为需要重渲染
  return context._currentValue;
}

// ═══════════════════════════════════════════════════════════════════════════
// 七、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== React Hooks 实现演示 ===\n");

// ── 模拟渲染框架 ──────────────────────────────────────────────────────

function simulateRender(Component, renderCount) {
  for (let i = 0; i < renderCount; i++) {
    hookIndex = 0;              // 每次渲染从头开始遍历 hook 链表
    isMount = i === 0;          // 第一次是 mount，后续是 update
    Component(i);
  }
}

// ── 测试 1：useState ──

console.log("【测试 1】useState\n");

currentFiber = createFiberNode();
isMount = true;
hookIndex = 0;

const [count1, setCount1] = useState(0);
console.log("  初始 count:", count1); // 0

// 模拟 dispatch 后重渲染
currentFiber.hooks[0].queue.push(5);   // setCount(5)
isMount = false;
hookIndex = 0;
const [count2] = useState(0);
console.log("  setCount(5) 后:", count2); // 5

// 函数式更新
currentFiber.hooks[0].queue.push((prev) => prev + 10);
hookIndex = 0;
const [count3] = useState(0);
console.log("  setCount(prev => prev + 10) 后:", count3); // 15

// ── 测试 2：useReducer ──

console.log("\n【测试 2】useReducer\n");

function counterReducer(state, action) {
  switch (action.type) {
    case "increment": return { count: state.count + action.step };
    case "decrement": return { count: state.count - action.step };
    case "reset":     return { count: 0 };
    default:          return state;
  }
}

currentFiber = createFiberNode();
isMount = true;
hookIndex = 0;

const [state1, dispatch1] = useReducer(counterReducer, { count: 0 });
console.log("  初始 state:", state1);

// 推入多个 action，一次性处理
currentFiber.hooks[0].queue.push({ type: "increment", step: 5 });
currentFiber.hooks[0].queue.push({ type: "increment", step: 3 });
currentFiber.hooks[0].queue.push({ type: "decrement", step: 2 });

isMount = false;
hookIndex = 0;
const [state2] = useReducer(counterReducer, { count: 0 });
console.log("  +5, +3, -2 后:", state2); // { count: 6 }

// ── 测试 3：useMemo ──

console.log("\n【测试 3】useMemo\n");

let computeCount = 0;
function expensiveCompute(a, b) {
  computeCount++;
  return a * b + 100;
}

currentFiber = createFiberNode();

// 第一次渲染：计算
isMount = true;
hookIndex = 0;
const result1 = useMemo(() => expensiveCompute(10, 20), [10, 20]);
console.log("  首次计算:", result1, `(compute 调用 ${computeCount} 次)`);

// 第二次渲染：deps 不变，使用缓存
isMount = false;
hookIndex = 0;
const result2 = useMemo(() => expensiveCompute(10, 20), [10, 20]);
console.log("  deps 不变:", result2, `(compute 调用 ${computeCount} 次 — 没有重新计算)`);

// 第三次渲染：deps 变了，重新计算
hookIndex = 0;
const result3 = useMemo(() => expensiveCompute(10, 30), [10, 30]);
console.log("  deps 变了:", result3, `(compute 调用 ${computeCount} 次)`);

// ── 测试 4：useCallback ──

console.log("\n【测试 4】useCallback\n");

currentFiber = createFiberNode();

isMount = true;
hookIndex = 0;
const fn1 = useCallback((x) => x * 2, [1]);

isMount = false;
hookIndex = 0;
const fn2 = useCallback((x) => x * 2, [1]);

hookIndex = 0;
const fn3 = useCallback((x) => x * 2, [2]); // deps 变了

console.log("  deps 不变时引用相同:", fn1 === fn2); // true
console.log("  deps 变了时引用不同:", fn1 === fn3); // false
console.log("  缓存的函数可正常调用:", fn1(21));    // 42

// ── 测试 5：useRef ──

console.log("\n【测试 5】useRef\n");

currentFiber = createFiberNode();

isMount = true;
hookIndex = 0;
const ref1 = useRef(0);
console.log("  初始 ref.current:", ref1.current);

ref1.current = 42; // 修改不触发重渲染

isMount = false;
hookIndex = 0;
const ref2 = useRef(0);
console.log("  修改后 ref.current:", ref2.current); // 42
console.log("  引用保持不变:", ref1 === ref2);       // true

// ── 测试 6：useContext ──

console.log("\n【测试 6】useContext\n");

const ThemeContext = createContext("light");
console.log("  默认值:", useContext(ThemeContext));

ThemeContext.Provider({ value: "dark", children: null });
console.log("  Provider 设为 dark 后:", useContext(ThemeContext));

ThemeContext.Provider({ value: { color: "blue", fontSize: 14 }, children: null });
console.log("  Provider 设为对象后:", JSON.stringify(useContext(ThemeContext)));

console.log("\n\n=== 面试要点 ===");
console.log("1. 所有 Hooks 以链表（数组）存在 Fiber.memoizedState 上，按调用顺序索引");
console.log("2. useState 底层就是 useReducer，reducer 是 (s, a) => typeof a === 'function' ? a(s) : a");
console.log("3. useMemo 缓存计算结果，useCallback 缓存函数引用（后者等于 useMemo(() => fn, deps)）");
console.log("4. deps 比较用 Object.is 逐项比较（浅比较），所以 deps 中放对象要小心");
console.log("5. useRef 就是 { current } 对象，跨渲染持久化，修改不触发重渲染");
console.log("6. useContext 读取 Context._currentValue，Provider value 变化时所有消费者都重渲染");
console.log("7. Hooks 不能放在条件/循环中 — 调用顺序必须稳定，否则链表对应关系错位");
