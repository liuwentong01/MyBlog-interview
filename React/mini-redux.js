/**
 * Mini Redux 完整实现
 *
 * ═══════════════════════════════════════════════════════
 *  Redux 三大原则
 * ═══════════════════════════════════════════════════════
 *
 * 1. 单一数据源（Single Source of Truth）
 *    整个应用的 state 存在一个 store 的 object tree 中
 *
 * 2. State 只读（State is Read-only）
 *    唯一改变 state 的方式是 dispatch 一个 action
 *
 * 3. 纯函数修改（Changes are made with Pure Functions）
 *    reducer 必须是纯函数：(prevState, action) => newState
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. createStore       — 核心：getState / dispatch / subscribe
 *  2. combineReducers   — 合并多个 reducer 为一个
 *  3. compose           — 函数组合（中间件用）
 *  4. applyMiddleware   — 中间件机制（洋葱模型）
 *  5. bindActionCreators — 将 actionCreator 绑定 dispatch
 *
 * 运行方式：node React/mini-redux.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、createStore
// ═══════════════════════════════════════════════════════════════════════════
//
// createStore 是 Redux 的核心，只做三件事：
//   1. 维护 state（闭包变量，外部不能直接修改）
//   2. dispatch(action) → 调用 reducer 计算新 state → 通知所有监听者
//   3. subscribe(listener) → 注册监听函数，返回取消订阅函数
//
// 设计精髓：
//   - state 只通过 getState() 暴露（只读）
//   - 只有 dispatch 能触发状态变更（可预测）
//   - subscribe 实现发布-订阅（UI 层监听变化来重渲染）

function createStore(reducer, preloadedState, enhancer) {
  // 如果传了 enhancer（如 applyMiddleware 的返回值），让 enhancer 来增强 createStore
  // 这是 Redux 中间件的入口点
  if (typeof enhancer === "function") {
    return enhancer(createStore)(reducer, preloadedState);
  }

  let state = preloadedState;
  let listeners = [];
  let isDispatching = false;  // 防止在 reducer 中 dispatch

  function getState() {
    return state;
  }

  function dispatch(action) {
    // action 必须是普通对象，必须有 type 属性
    if (typeof action.type === "undefined") {
      throw new Error("Actions must have a type property");
    }

    // 防止在 reducer 中调用 dispatch（会导致死循环）
    if (isDispatching) {
      throw new Error("Reducers may not dispatch actions");
    }

    try {
      isDispatching = true;
      // 核心：用 reducer 计算新 state
      state = reducer(state, action);
    } finally {
      isDispatching = false;
    }

    // 通知所有监听者
    // 拷贝一份 listeners，防止在回调中 subscribe/unsubscribe 导致遍历异常
    const currentListeners = listeners.slice();
    currentListeners.forEach((listener) => listener());

    return action; // 返回 action 方便链式调用
  }

  function subscribe(listener) {
    listeners.push(listener);

    let isSubscribed = true;
    // 返回取消订阅函数
    return function unsubscribe() {
      if (!isSubscribed) return;
      isSubscribed = false;
      const index = listeners.indexOf(listener);
      listeners.splice(index, 1);
    };
  }

  // 初始化：dispatch 一个内部 action，让所有 reducer 返回默认值
  // 这就是为什么 reducer 的 switch 必须有 default 返回初始 state
  dispatch({ type: "@@REDUX/INIT" });

  return { getState, dispatch, subscribe };
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、combineReducers
// ═══════════════════════════════════════════════════════════════════════════
//
// 作用：把多个小 reducer 合并为一个大 reducer
//
// 输入：
//   { counter: counterReducer, todos: todosReducer }
//
// 输出：一个新的 reducer，state 结构为：
//   { counter: counterState, todos: todosState }
//
// 原理：
//   遍历每个 reducer，各自处理自己的 state 切片
//   有任何一个切片变了，就返回新对象（触发重渲染）
//   全部没变，返回原对象（引用不变 → React.memo 可跳过渲染）

function combineReducers(reducers) {
  const reducerKeys = Object.keys(reducers);

  return function combination(state = {}, action) {
    let hasChanged = false;
    const nextState = {};

    for (const key of reducerKeys) {
      const reducer = reducers[key];
      const prevStateForKey = state[key];
      const nextStateForKey = reducer(prevStateForKey, action);

      nextState[key] = nextStateForKey;
      // 用 === 判断是否变化（这就是为什么 reducer 中不能直接修改 state，必须返回新对象）
      hasChanged = hasChanged || nextStateForKey !== prevStateForKey;
    }

    // 没变化就返回旧引用（性能优化）
    return hasChanged ? nextState : state;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、compose
// ═══════════════════════════════════════════════════════════════════════════
//
// compose(f, g, h) → (...args) => f(g(h(...args)))
//
// 在 Redux 中用于组合多个 middleware 的 dispatch 增强函数
// 执行顺序：从右到左（数学上的函数组合）
// 但对于中间件来说，middleware 列表从左到右 = action 的处理顺序（洋葱模型）

function compose(...funcs) {
  if (funcs.length === 0) return (arg) => arg;
  if (funcs.length === 1) return funcs[0];
  return funcs.reduce((a, b) => (...args) => a(b(...args)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、applyMiddleware（面试重点！）
// ═══════════════════════════════════════════════════════════════════════════
//
// 中间件签名（三层柯里化）：
//   store => next => action => { ... }
//
// 为什么是三层？
//   第一层 (store)：中间件需要 getState 和 dispatch
//   第二层 (next)：调用下一个中间件（洋葱模型的核心）
//   第三层 (action)：实际处理 action 的逻辑
//
// 洋葱模型：
//   dispatch(action)
//     → middleware1 进入
//       → middleware2 进入
//         → 原始 dispatch（reducer）
//       ← middleware2 退出
//     ← middleware1 退出
//
// applyMiddleware 的核心逻辑：
//   1. 给每个中间件注入 { getState, dispatch }
//   2. 用 compose 把所有中间件串成一条链
//   3. 用这条链包装原始 dispatch
//
// 关键实现细节：
//   middlewareAPI 中的 dispatch 用的是包装后的版本（通过闭包引用）
//   这样中间件中调用 dispatch 会重新走整个中间件链（如 redux-thunk 中的 dispatch）

function applyMiddleware(...middlewares) {
  // 返回一个 enhancer 函数
  // enhancer 接收 createStore，返回增强版的 createStore
  return function enhancer(createStore) {
    return function enhancedCreateStore(reducer, preloadedState) {
      // 先创建原始 store
      const store = createStore(reducer, preloadedState);

      // 这个 dispatch 会在下面被替换为增强版
      // 用 let 是因为要在中间件链构建完成后指向最终版本
      let dispatch = () => {
        throw new Error("Dispatching while constructing middleware is not allowed");
      };

      // 给中间件暴露的 API
      const middlewareAPI = {
        getState: store.getState,
        // 注意：这里用箭头函数包一层，确保中间件拿到的 dispatch 是最终版本
        dispatch: (action) => dispatch(action),
      };

      // 第一层调用：注入 store API → 得到 next => action => { ... }
      const chain = middlewares.map((mw) => mw(middlewareAPI));

      // compose 把链串起来，包装原始 dispatch
      // chain = [mw1(next=>action=>...), mw2(next=>action=>...)]
      // compose(mw1, mw2)(store.dispatch)
      //   = mw1(mw2(store.dispatch))
      //   = mw1 的 next 指向 mw2，mw2 的 next 指向原始 dispatch
      dispatch = compose(...chain)(store.dispatch);

      return {
        ...store,
        dispatch, // 替换为增强版 dispatch
      };
    };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、bindActionCreators
// ═══════════════════════════════════════════════════════════════════════════
//
// 作用：把 actionCreator 和 dispatch 绑定
//   原来：dispatch(increment(5))
//   绑定后：boundIncrement(5)  ← 自动 dispatch
//
// 用在 React-Redux 的 mapDispatchToProps 中

function bindActionCreators(actionCreators, dispatch) {
  const bound = {};
  for (const key of Object.keys(actionCreators)) {
    const creator = actionCreators[key];
    bound[key] = (...args) => dispatch(creator(...args));
  }
  return bound;
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini Redux 演示 ===\n");

// ── 定义 reducer ──

function counterReducer(state = { count: 0 }, action) {
  switch (action.type) {
    case "INCREMENT":
      return { count: state.count + action.payload };
    case "DECREMENT":
      return { count: state.count - action.payload };
    default:
      return state;
  }
}

function todosReducer(state = [], action) {
  switch (action.type) {
    case "ADD_TODO":
      return [...state, { text: action.payload, done: false }];
    case "TOGGLE_TODO":
      return state.map((todo, i) =>
        i === action.payload ? { ...todo, done: !todo.done } : todo
      );
    default:
      return state;
  }
}

// ── 测试 1：基础 createStore ──

console.log("【测试 1】createStore 基础用法\n");

const store1 = createStore(counterReducer);
console.log("  初始 state:", store1.getState());

const unsub = store1.subscribe(() => {
  console.log("  [listener] state changed:", store1.getState());
});

store1.dispatch({ type: "INCREMENT", payload: 5 });
store1.dispatch({ type: "DECREMENT", payload: 2 });

unsub(); // 取消订阅
store1.dispatch({ type: "INCREMENT", payload: 100 }); // 不再触发 listener
console.log("  取消订阅后 state:", store1.getState());

// ── 测试 2：combineReducers ──

console.log("\n【测试 2】combineReducers\n");

const rootReducer = combineReducers({
  counter: counterReducer,
  todos: todosReducer,
});

const store2 = createStore(rootReducer);
console.log("  初始 state:", JSON.stringify(store2.getState()));

store2.dispatch({ type: "INCREMENT", payload: 10 });
store2.dispatch({ type: "ADD_TODO", payload: "学 Redux 原理" });
store2.dispatch({ type: "ADD_TODO", payload: "手写 middleware" });
store2.dispatch({ type: "TOGGLE_TODO", payload: 0 });

console.log("  最终 state:", JSON.stringify(store2.getState(), null, 2));

// ── 测试 3：中间件 ──

console.log("\n【测试 3】applyMiddleware\n");

// 中间件 1：logger（打印 action 和 state 变化）
const logger = (store) => (next) => (action) => {
  console.log("  [logger] dispatching:", action.type);
  const result = next(action); // 调用下一个中间件（或原始 dispatch）
  console.log("  [logger] next state:", JSON.stringify(store.getState()));
  return result;
};

// 中间件 2：thunk（支持 dispatch 函数，而不仅是对象）
const thunk = (store) => (next) => (action) => {
  // 如果 action 是函数，执行它并传入 dispatch 和 getState
  if (typeof action === "function") {
    return action(store.dispatch, store.getState);
  }
  // 否则正常传递
  return next(action);
};

const store3 = createStore(
  counterReducer,
  { count: 0 },
  applyMiddleware(thunk, logger) // thunk 在前，先处理函数 action
);

// 普通 dispatch
store3.dispatch({ type: "INCREMENT", payload: 1 });

// thunk：dispatch 一个函数（异步 action）
console.log("\n  --- async action (thunk) ---");
store3.dispatch((dispatch, getState) => {
  console.log("  [thunk] current state:", getState());
  dispatch({ type: "INCREMENT", payload: 10 });
  dispatch({ type: "DECREMENT", payload: 3 });
  console.log("  [thunk] after async:", getState());
});

// ── 测试 4：bindActionCreators ──

console.log("\n【测试 4】bindActionCreators\n");

const actionCreators = {
  increment: (amount) => ({ type: "INCREMENT", payload: amount }),
  decrement: (amount) => ({ type: "DECREMENT", payload: amount }),
};

const store4 = createStore(counterReducer);
const bound = bindActionCreators(actionCreators, store4.dispatch);

bound.increment(100);
bound.decrement(30);
console.log("  最终 state:", store4.getState());

// ── 测试 5：compose ──

console.log("\n【测试 5】compose\n");

const add1 = (x) => x + 1;
const double = (x) => x * 2;
const square = (x) => x * x;

const composed = compose(square, double, add1);
console.log("  compose(square, double, add1)(3)");
console.log("  = square(double(add1(3)))");
console.log("  = square(double(4))");
console.log("  = square(8)");
console.log("  = " + composed(3)); // 64

console.log("\n\n=== 面试要点 ===");
console.log("1. createStore 核心：闭包存 state + dispatch 调 reducer + subscribe 发布订阅");
console.log("2. combineReducers：遍历子 reducer，各自处理 state 切片，用 === 判断是否变化");
console.log("3. applyMiddleware 是 enhancer，增强 createStore 的 dispatch");
console.log("4. 中间件三层柯里化：store => next => action => {}");
console.log("5. compose 从右到左组合函数，但中间件处理 action 的顺序是从左到右（洋葱模型）");
console.log("6. redux-thunk 核心只有几行：action 是函数就执行它，否则 next(action)");
console.log("7. dispatch 会触发所有 subscribe 的 listener（React-Redux 中用于触发重渲染）");
