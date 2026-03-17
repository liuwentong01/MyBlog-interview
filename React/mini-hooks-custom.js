/**
 * 自定义 Hooks 实现 — useDebounce / useThrottle / usePrevious / useMount
 *
 * ═══════════════════════════════════════════════════════
 *  自定义 Hook 的本质
 * ═══════════════════════════════════════════════════════
 *
 * 自定义 Hook 就是一个以 use 开头的函数，内部使用了其他 Hooks。
 * 没有魔法——它只是逻辑复用的一种方式。
 *
 * 核心难点不在于"怎么封装"，而在于：
 *   1. 正确处理闭包（useRef 保持最新引用）
 *   2. 正确处理清理（useEffect 的 cleanup）
 *   3. 理解渲染和副作用的时序
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. useDebounce      — 防抖值 / 防抖回调
 *  2. useThrottle      — 节流回调
 *  3. usePrevious      — 获取上一次渲染的值
 *  4. useMount         — 仅在 mount 时执行
 *  5. useUnmount       — 仅在 unmount 时执行
 *  6. useLatest        — 始终拿到最新值（解决闭包陷阱）
 *  7. useUpdate        — 强制重渲染
 *
 * 运行方式：node React/mini-hooks-custom.js
 */

// ── 模拟 React Hooks 基础设施（复用 mini-hooks.js 的思路）──────────────

let _fiber = { hooks: [] };
let _hookIndex = 0;
let _isMount = true;
let _renderCount = 0;

function resetHooks(mount = false) {
  _hookIndex = 0;
  _isMount = mount;
  _renderCount++;
}

function getHook() {
  let hook;
  if (_isMount) {
    hook = { memoizedState: null, queue: [] };
    _fiber.hooks.push(hook);
  } else {
    hook = _fiber.hooks[_hookIndex];
  }
  _hookIndex++;
  return hook;
}

// 基础 hooks（简化版，足以支撑自定义 hooks 演示）
function useState(initial) {
  const hook = getHook();
  if (_isMount) hook.memoizedState = typeof initial === "function" ? initial() : initial;
  hook.queue.forEach((action) => {
    hook.memoizedState = typeof action === "function" ? action(hook.memoizedState) : action;
  });
  hook.queue = [];
  return [hook.memoizedState, (action) => hook.queue.push(action)];
}

function useRef(initial) {
  const hook = getHook();
  if (_isMount) hook.memoizedState = { current: initial };
  return hook.memoizedState;
}

// 简化版 useEffect：立即执行（真实 React 在 commit 后异步执行）
function useEffect(callback, deps) {
  const hook = getHook();
  if (_isMount) {
    hook.memoizedState = { deps, cleanup: null };
    const cleanup = callback();
    hook.memoizedState.cleanup = typeof cleanup === "function" ? cleanup : null;
    return;
  }
  const prevDeps = hook.memoizedState.deps;
  const changed = !deps || !prevDeps || deps.some((d, i) => !Object.is(d, prevDeps[i]));
  if (changed) {
    if (hook.memoizedState.cleanup) hook.memoizedState.cleanup();
    hook.memoizedState.deps = deps;
    const cleanup = callback();
    hook.memoizedState.cleanup = typeof cleanup === "function" ? cleanup : null;
  }
}

function useCallback(fn, deps) {
  const hook = getHook();
  if (_isMount) {
    hook.memoizedState = [fn, deps];
    return fn;
  }
  const [, prevDeps] = hook.memoizedState;
  if (deps && prevDeps && deps.length === prevDeps.length && deps.every((d, i) => Object.is(d, prevDeps[i]))) {
    return hook.memoizedState[0];
  }
  hook.memoizedState = [fn, deps];
  return fn;
}

// ═══════════════════════════════════════════════════════════════════════════
// 一、useLatest — 始终拿到最新值
// ═══════════════════════════════════════════════════════════════════════════
//
// 解决的问题：闭包陷阱
//
//   function Counter() {
//     const [count, setCount] = useState(0);
//     useEffect(() => {
//       setInterval(() => {
//         console.log(count); // 永远是 0！闭包捕获了初始值
//       }, 1000);
//     }, []);
//   }
//
// 用 useLatest：
//   const countRef = useLatest(count);
//   setInterval(() => console.log(countRef.current), 1000); // 始终最新

function useLatest(value) {
  const ref = useRef(value);
  // 每次渲染都更新 ref.current 为最新值
  ref.current = value;
  return ref;
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、useDebounce — 防抖
// ═══════════════════════════════════════════════════════════════════════════
//
// 两种形式：
//   useDebounce(value, delay)    → 返回防抖后的值
//   useDebounceFn(fn, delay)     → 返回防抖后的函数
//
// 关键实现细节：
//   用 useRef 保存 timer，因为：
//   1. timer 需要跨渲染持久化（不能用 state，否则会触发重渲染）
//   2. cleanup 时需要清理 timer

// 防抖值：输入值变化后等 delay ms 才更新
function useDebounceValue(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);

    // cleanup：值变化时清除上一次的定时器
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

// 防抖函数：调用后等 delay ms 才真正执行
function useDebounceFn(fn, delay) {
  const fnRef = useLatest(fn);  // 用 ref 保持最新回调（避免闭包陷阱）
  const timerRef = useRef(null);

  const debouncedFn = useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fnRef.current(...args);
    }, delay);
  }, [delay]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return debouncedFn;
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、useThrottle — 节流
// ═══════════════════════════════════════════════════════════════════════════
//
// 和 useDebounce 类似，区别：
//   防抖：最后一次调用后等 delay 执行
//   节流：每 delay ms 最多执行一次

function useThrottleFn(fn, delay) {
  const fnRef = useLatest(fn);
  const lastExecRef = useRef(0);   // 上次执行的时间戳
  const timerRef = useRef(null);

  const throttledFn = useCallback((...args) => {
    const now = Date.now();
    const remaining = delay - (now - lastExecRef.current);

    if (remaining <= 0) {
      // 已超过间隔，立即执行
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastExecRef.current = now;
      fnRef.current(...args);
    } else if (!timerRef.current) {
      // 间隔内，设置定时器保证最后一次不丢失
      timerRef.current = setTimeout(() => {
        lastExecRef.current = Date.now();
        timerRef.current = null;
        fnRef.current(...args);
      }, remaining);
    }
  }, [delay]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return throttledFn;
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、usePrevious — 获取上一次渲染的值
// ═══════════════════════════════════════════════════════════════════════════
//
// 原理：useRef 在 useEffect 中更新（useEffect 在渲染后执行）
//   渲染阶段：ref.current 还是旧值 → 返回旧值
//   副作用阶段：更新 ref.current = 新值
//   下次渲染：ref.current 就是"上一次的值"

function usePrevious(value) {
  const ref = useRef(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current; // 返回的是更新前的值
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、useMount / useUnmount
// ═══════════════════════════════════════════════════════════════════════════
//
// 语义化封装：
//   useMount = useEffect(fn, [])    — 空依赖 = 只在 mount 执行一次
//   useUnmount = useEffect(() => fn, [])  — 返回的 cleanup 在 unmount 时执行

function useMount(fn) {
  // [] 空依赖数组 → 只在 mount 时执行
  useEffect(() => {
    fn();
  }, []);
}

function useUnmount(fn) {
  // 用 ref 保持最新引用，确保 unmount 时执行的是最新的 fn
  const fnRef = useLatest(fn);
  useEffect(() => {
    return () => fnRef.current();
  }, []);
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、useUpdate — 强制重渲染
// ═══════════════════════════════════════════════════════════════════════════
//
// 原理：用一个无意义的 state 变化触发重渲染
// 用途：需要跳过 React 的优化强制刷新时（很少用）

function useUpdate() {
  const [, setState] = useState({});
  return useCallback(() => setState({}), []);
}

// ═══════════════════════════════════════════════════════════════════════════
// 七、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== 自定义 Hooks 演示 ===\n");

// ── 测试 1：useLatest ──

console.log("【测试 1】useLatest — 解决闭包陷阱\n");

_fiber = { hooks: [] };
resetHooks(true);

let latestValue = "hello";
const latestRef = useLatest(latestValue);
console.log("  初始值:", latestRef.current);

latestValue = "world";
resetHooks();
useLatest(latestValue); // 模拟重渲染
// 直接检查 ref.current（因为 useLatest 每次渲染更新 ref）
console.log("  更新后:", _fiber.hooks[0].memoizedState.current);

// ── 测试 2：usePrevious ──

console.log("\n【测试 2】usePrevious — 获取上一次渲染的值\n");

_fiber = { hooks: [] };

resetHooks(true);
let currentValue = 1;
let prev = usePrevious(currentValue);
console.log(`  render 1: value=${currentValue}, previous=${prev}`); // undefined（首次没有上一次）

resetHooks();
currentValue = 2;
prev = usePrevious(currentValue);
console.log(`  render 2: value=${currentValue}, previous=${prev}`); // 1

resetHooks();
currentValue = 5;
prev = usePrevious(currentValue);
console.log(`  render 3: value=${currentValue}, previous=${prev}`); // 2

// ── 测试 3：useDebounceValue ──

console.log("\n【测试 3】useDebounceValue\n");

_fiber = { hooks: [] };

resetHooks(true);
let input = "h";
let debouncedVal = useDebounceValue(input, 300);
console.log(`  输入 "${input}" → debounced = "${debouncedVal}" (首次，同步返回)`);

resetHooks();
input = "he";
debouncedVal = useDebounceValue(input, 300);
console.log(`  输入 "${input}" → debounced = "${debouncedVal}" (还没到 300ms，返回旧值)`);

resetHooks();
input = "hel";
debouncedVal = useDebounceValue(input, 300);
console.log(`  输入 "${input}" → debounced = "${debouncedVal}" (300ms 后才会更新为 "hel")`);

// ── 测试 4：useMount / useUnmount ──

console.log("\n【测试 4】useMount / useUnmount\n");

_fiber = { hooks: [] };

resetHooks(true);
useMount(() => console.log("  [mount] 组件挂载了"));
useUnmount(() => console.log("  [unmount] 组件卸载了"));

resetHooks();
console.log("  (第二次渲染 — mount 不再执行)");

// ── 测试 5：useUpdate ──

console.log("\n【测试 5】useUpdate — 强制重渲染\n");

_fiber = { hooks: [] };

resetHooks(true);
const [, setS] = useState({});
const forceUpdate = useUpdate();
console.log("  调用 forceUpdate() → setState({}) → 触发重渲染");
console.log("  原理: 每次传入新对象 {}，引用必然不同，React 必然重渲染");

console.log("\n\n=== 面试要点 ===");
console.log("1. useLatest: 用 useRef 保持最新值，每次渲染更新 ref.current，解决闭包陷阱");
console.log("2. useDebounce: useRef 存 timer + useEffect cleanup 清理 + useLatest 保持最新回调");
console.log("3. useThrottle: 类似 debounce，但用时间戳判断是否可执行 + trailing 定时器");
console.log("4. usePrevious: useRef + useEffect（渲染后更新），返回时 ref 还是旧值");
console.log("5. useMount/useUnmount: useEffect(fn, []) 的语义化封装");
console.log("6. 自定义 Hook 的关键：useRef 跨渲染持久化 + useEffect cleanup 清理资源");
console.log("7. 闭包陷阱是面试高频问题：useEffect/setTimeout 中的值是闭包快照，不是最新值");
