/**
 * Redux 中间件详解 — thunk + logger + promise
 *
 * ═══════════════════════════════════════════════════════
 *  中间件签名（三层柯里化）
 * ═══════════════════════════════════════════════════════
 *
 * const middleware = store => next => action => {
 *   // store: { getState, dispatch }（注意 dispatch 是增强后的版本）
 *   // next: 调用下一个中间件（链中的下一环）
 *   // action: 当前被 dispatch 的 action
 *
 *   // 在 next 之前 = action 到达 reducer 之前（进入洋葱）
 *   const result = next(action);
 *   // 在 next 之后 = action 已经被 reducer 处理（退出洋葱）
 *   return result;
 * }
 *
 * ═══════════════════════════════════════════════════════
 *  洋葱模型
 * ═══════════════════════════════════════════════════════
 *
 * applyMiddleware(thunk, logger, reporter)
 *
 * dispatch(action) 的执行路径：
 *
 *   → thunk (进入)
 *     → logger (进入)
 *       → reporter (进入)
 *         → 原始 dispatch（reducer 计算新 state）
 *       ← reporter (退出)
 *     ← logger (退出)
 *   ← thunk (退出)
 *
 * 中间件注册顺序 = action 处理顺序（从左到右）
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现的中间件
 * ═══════════════════════════════════════════════════════
 *
 *  1. thunk    — 支持 dispatch 函数（异步 action）
 *  2. logger   — 打印 action 和 state 变化
 *  3. promise  — 支持 dispatch Promise
 *  4. crash    — 捕获 reducer 异常
 *
 * 运行方式：node React/mini-redux-middleware.js
 */

// ── 复用 mini-redux 的核心实现 ──────────────────────────────────────────

function createStore(reducer, preloadedState, enhancer) {
  if (typeof enhancer === "function") {
    return enhancer(createStore)(reducer, preloadedState);
  }
  let state = preloadedState;
  let listeners = [];
  let isDispatching = false;

  function getState() { return state; }

  function dispatch(action) {
    if (isDispatching) throw new Error("Reducers may not dispatch actions");
    try {
      isDispatching = true;
      state = reducer(state, action);
    } finally {
      isDispatching = false;
    }
    listeners.slice().forEach((l) => l());
    return action;
  }

  function subscribe(listener) {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }

  dispatch({ type: "@@REDUX/INIT" });
  return { getState, dispatch, subscribe };
}

function compose(...funcs) {
  if (funcs.length === 0) return (arg) => arg;
  if (funcs.length === 1) return funcs[0];
  return funcs.reduce((a, b) => (...args) => a(b(...args)));
}

function applyMiddleware(...middlewares) {
  return (createStore) => (reducer, preloadedState) => {
    const store = createStore(reducer, preloadedState);
    let dispatch = () => { throw new Error("Dispatching during middleware setup"); };
    const api = {
      getState: store.getState,
      dispatch: (action) => dispatch(action),
    };
    const chain = middlewares.map((mw) => mw(api));
    dispatch = compose(...chain)(store.dispatch);
    return { ...store, dispatch };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 一、redux-thunk（面试最常考的中间件）
// ═══════════════════════════════════════════════════════════════════════════
//
// 核心逻辑（真实 redux-thunk 源码也就这么几行）：
//   如果 action 是函数 → 执行它，传入 dispatch 和 getState
//   如果 action 是对象 → 正常传递给下一个中间件
//
// 为什么需要 thunk？
//   Redux 的 reducer 是同步的，dispatch 只接受普通对象
//   异步操作（如 API 请求）需要在中间件层拦截处理
//
// 用法：
//   dispatch((dispatch, getState) => {
//     fetch('/api/user').then(res => res.json()).then(data => {
//       dispatch({ type: 'SET_USER', payload: data });
//     });
//   });

const thunk = ({ dispatch, getState }) => (next) => (action) => {
  if (typeof action === "function") {
    // action 是函数 → 执行它
    // 注意传入的 dispatch 是增强后的版本（会重新走中间件链）
    return action(dispatch, getState);
  }
  // action 是普通对象 → 传给下一个中间件
  return next(action);
};

// ═══════════════════════════════════════════════════════════════════════════
// 二、logger（经典面试题：手写一个 logger 中间件）
// ═══════════════════════════════════════════════════════════════════════════
//
// 在 next 前后分别打印，清晰展示洋葱模型：
//   → dispatching: INCREMENT
//   ← next state: { count: 1 }

const logger = ({ getState }) => (next) => (action) => {
  console.log("  [logger] → dispatching:", action.type || action);
  console.log("  [logger]   prev state:", JSON.stringify(getState()));

  const result = next(action); // 调用下一个中间件 → 最终到达 reducer

  console.log("  [logger] ← next state:", JSON.stringify(getState()));
  console.log("");
  return result;
};

// ═══════════════════════════════════════════════════════════════════════════
// 三、promise 中间件
// ═══════════════════════════════════════════════════════════════════════════
//
// 支持 dispatch 一个 Promise 或一个 payload 为 Promise 的 action
//
// 用法 1：dispatch(fetchUser())  ← fetchUser 返回 Promise
// 用法 2：dispatch({ type: 'FETCH_USER', payload: fetch('/api/user') })

const promise = ({ dispatch }) => (next) => (action) => {
  // action 本身是 Promise
  if (action instanceof Promise) {
    return action.then(dispatch);
  }
  // action.payload 是 Promise
  if (action.payload instanceof Promise) {
    return action.payload
      .then((result) => dispatch({ ...action, payload: result }))
      .catch((error) => dispatch({ ...action, payload: error, error: true }));
  }
  return next(action);
};

// ═══════════════════════════════════════════════════════════════════════════
// 四、crash reporter（异常捕获）
// ═══════════════════════════════════════════════════════════════════════════
//
// 捕获 reducer 或后续中间件的异常，防止应用崩溃

const crashReporter = () => (next) => (action) => {
  try {
    return next(action);
  } catch (err) {
    console.error("  [crash] reducer 异常:", err.message);
    console.error("  [crash] action:", action);
    // 真实场景：上报错误到 Sentry 等监控平台
    return undefined;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

function counterReducer(state = { count: 0 }, action) {
  switch (action.type) {
    case "INCREMENT":
      return { count: state.count + (action.payload || 1) };
    case "DECREMENT":
      return { count: state.count - (action.payload || 1) };
    case "THROW_ERROR":
      throw new Error("Intentional reducer error!");
    default:
      return state;
  }
}

console.log("=== Redux 中间件详解 ===\n");

// ── 测试：中间件执行顺序 ──

console.log("【测试 1】洋葱模型执行顺序\n");

const store = createStore(
  counterReducer,
  { count: 0 },
  applyMiddleware(thunk, logger, crashReporter)
);

store.dispatch({ type: "INCREMENT", payload: 5 });

// ── 测试：thunk 异步 action ──

console.log("【测试 2】thunk 异步 action\n");

// 模拟异步 actionCreator
const asyncIncrement = (amount) => (dispatch, getState) => {
  console.log("  [thunk] 异步开始, 当前 state:", getState());
  // 模拟 API 请求（用 setTimeout 的同步替代）
  dispatch({ type: "INCREMENT", payload: amount });
  console.log("  [thunk] 异步完成, 当前 state:", getState());
};

store.dispatch(asyncIncrement(10));

// ── 测试：crashReporter ──

console.log("【测试 3】crashReporter 异常捕获\n");

store.dispatch({ type: "THROW_ERROR" });
console.log("  应用没有崩溃，state 仍然可用:", store.getState());

console.log("\n\n=== 面试要点 ===");
console.log("1. 中间件签名三层柯里化：store => next => action => {}");
console.log("2. next(action) 调用下一个中间件，最终到达原始 dispatch");
console.log("3. next 之前 = 进入洋葱（action 处理前），next 之后 = 退出洋葱（state 已更新）");
console.log("4. redux-thunk 只做一件事：action 是函数就执行，否则 next(action)");
console.log("5. applyMiddleware 中 dispatch 用闭包引用，确保中间件中 dispatch 走完整链路");
console.log("6. 中间件注册顺序 = action 到达 reducer 的顺序（从左到右）");
