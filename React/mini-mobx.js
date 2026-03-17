/**
 * Mini MobX — 响应式状态管理实现
 *
 * ═══════════════════════════════════════════════════════
 *  MobX 的核心思想
 * ═══════════════════════════════════════════════════════
 *
 * 与 Redux 的区别：
 *   Redux：手动 dispatch → reducer 计算 → 通知订阅者 → 手动获取新状态
 *   MobX ：直接修改状态 → 自动追踪依赖 → 自动通知用到这个状态的地方
 *
 * 三个核心概念：
 *   observable  — 可观察的状态（被 Proxy 拦截 get/set）
 *   autorun     — 自动执行的副作用（读取了哪些 observable 就订阅哪些）
 *   computed    — 派生值（基于 observable 计算，有缓存，依赖变了才重算）
 *
 * 核心机制：依赖收集（和 Vue 3 的响应式原理完全相同）
 *   1. autorun 执行时，设置全局 currentEffect
 *   2. 访问 observable 的属性 → Proxy get 触发 → 收集 currentEffect 到依赖列表
 *   3. 修改 observable 的属性 → Proxy set 触发 → 通知所有依赖的 effect 重新执行
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. observable   — 用 Proxy 拦截 get/set
 *  2. autorun      — 自动追踪依赖 + 响应变化
 *  3. computed     — 有缓存的派生值
 *  4. reaction     — 精确控制的副作用（分离"追踪"和"执行"）
 *
 * 运行方式：node React/mini-mobx.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、依赖收集系统
// ═══════════════════════════════════════════════════════════════════════════
//
// 全局变量 currentEffect：
//   当 autorun/computed 执行时，设置为当前的 effect
//   observable 的 get 拦截器读取 currentEffect，将其收集为依赖
//   effect 执行完毕后，currentEffect 恢复为 null

let currentEffect = null;
const effectStack = []; // 嵌套 effect 用栈管理

function pushEffect(effect) {
  effectStack.push(effect);
  currentEffect = effect;
}

function popEffect() {
  effectStack.pop();
  currentEffect = effectStack[effectStack.length - 1] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、observable — 可观察对象
// ═══════════════════════════════════════════════════════════════════════════
//
// 用 Proxy 拦截 get 和 set：
//   get → 收集当前 effect 到该属性的依赖列表（track）
//   set → 通知该属性的所有依赖重新执行（trigger）
//
// depsMap 结构：
//   WeakMap<target, Map<key, Set<effect>>>
//   target = 原始对象
//   key = 属性名
//   Set<effect> = 依赖这个属性的所有 autorun/computed

const targetMap = new WeakMap();

function track(target, key) {
  if (!currentEffect) return;

  let depsMap = targetMap.get(target);
  if (!depsMap) {
    depsMap = new Map();
    targetMap.set(target, depsMap);
  }

  let deps = depsMap.get(key);
  if (!deps) {
    deps = new Set();
    depsMap.set(key, deps);
  }

  deps.add(currentEffect);
  // 让 effect 也记住自己被哪些 deps Set 收集了（用于 dispose 时清理）
  if (currentEffect.deps) {
    currentEffect.deps.push(deps);
  }
}

function trigger(target, key) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;

  const deps = depsMap.get(key);
  if (!deps) return;

  // 通知所有依赖重新执行
  // 用 [...deps] 拷贝一份，防止在执行过程中修改 Set
  [...deps].forEach((effect) => {
    // 避免无限循环：如果当前正在执行的 effect 又被触发，跳过
    if (effect !== currentEffect) {
      effect.run();
    }
  });
}

function observable(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      const result = Reflect.get(target, key, receiver);
      // 收集依赖
      track(target, key);
      // 如果属性值也是对象，递归代理（深度响应式）
      if (typeof result === "object" && result !== null) {
        return observable(result);
      }
      return result;
    },

    set(target, key, value, receiver) {
      const oldValue = target[key];
      const result = Reflect.set(target, key, value, receiver);
      // 值真的变了才通知（避免无意义的更新）
      if (!Object.is(oldValue, value)) {
        trigger(target, key);
      }
      return result;
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、autorun — 自动追踪的副作用
// ═══════════════════════════════════════════════════════════════════════════
//
// autorun(fn)：
//   1. 立即执行 fn 一次
//   2. fn 执行时访问的所有 observable 属性会被自动追踪
//   3. 这些属性变化时，fn 自动重新执行
//
// 返回 disposer 函数，调用后取消追踪

function autorun(fn) {
  const effect = {
    deps: [], // 记录被哪些 deps Set 收集了
    run() {
      // 清除旧依赖（重新收集）
      effect.deps.forEach((depSet) => depSet.delete(effect));
      effect.deps.length = 0;
      pushEffect(effect);
      try {
        fn();
      } finally {
        popEffect();
      }
    },
  };

  effect.run(); // 首次立即执行（收集依赖）

  // 返回取消函数
  return function disposer() {
    // 从 effect 自己记录的所有 deps Set 中移除自己
    effect.deps.forEach((depSet) => depSet.delete(effect));
    effect.deps.length = 0;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、computed — 有缓存的派生值
// ═══════════════════════════════════════════════════════════════════════════
//
// computed(() => state.firstName + ' ' + state.lastName)
//
// 特点：
//   1. 惰性求值：只有被访问 .value 时才计算
//   2. 缓存：依赖没变就返回缓存值（不重新计算）
//   3. 依赖变了 → 标记为 dirty → 下次访问时重新计算
//
// 本质上 computed 既是 observer（追踪自己的依赖）
// 又是 observable（被别的 autorun 追踪）

function computed(getter) {
  let cachedValue;
  let dirty = true;

  // computed 自身也是一个 effect
  const effect = {
    run() {
      // 依赖变了 → 标记为 dirty
      dirty = true;
      // 通知依赖 computed 的 autorun 重新执行
      trigger(computedObj, "value");
    },
  };

  const computedObj = {
    get value() {
      // 收集：谁读了 computed.value → 追踪它
      track(computedObj, "value");

      if (dirty) {
        // 执行 getter，收集 getter 的依赖
        pushEffect(effect);
        try {
          cachedValue = getter();
        } finally {
          popEffect();
        }
        dirty = false;
      }

      return cachedValue;
    },
  };

  return computedObj;
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、reaction — 精确控制的副作用
// ═══════════════════════════════════════════════════════════════════════════
//
// reaction(dataFn, effectFn)
//   dataFn → 追踪依赖，返回数据（只追踪这里面的访问）
//   effectFn → 数据变化时执行（不追踪这里面的访问）
//
// 与 autorun 的区别：
//   autorun：追踪 fn 中所有访问的 observable → 任何一个变了就重跑整个 fn
//   reaction：只追踪 dataFn 中的访问 → 更精确，不会过度响应

function reaction(dataFn, effectFn) {
  let firstRun = true;
  let prevData;

  const effect = {
    deps: [],
    run() {
      effect.deps.forEach((depSet) => depSet.delete(effect));
      effect.deps.length = 0;
      pushEffect(effect);
      let data;
      try {
        data = dataFn();
      } finally {
        popEffect();
      }

      if (firstRun) {
        firstRun = false;
        prevData = data;
        return; // 首次不执行 effectFn
      }

      // 数据变了才执行 effectFn
      if (!Object.is(data, prevData)) {
        effectFn(data, prevData);
        prevData = data;
      }
    },
  };

  effect.run();

  return function disposer() {
    effect.deps.forEach((depSet) => depSet.delete(effect));
    effect.deps.length = 0;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini MobX 演示 ===\n");

// ── 测试 1：observable + autorun ──

console.log("【测试 1】observable + autorun（自动追踪依赖）\n");

const user = observable({
  firstName: "张",
  lastName: "三",
  age: 25,
});

console.log("  autorun 1: 追踪 firstName + lastName");
const dispose1 = autorun(() => {
  console.log(`    → 执行: ${user.firstName}${user.lastName}`);
});

console.log("\n  修改 firstName:");
user.firstName = "李";  // 触发 autorun

console.log("\n  修改 age（autorun 没用到 age，不触发）:");
user.age = 30;

console.log("\n  修改 lastName:");
user.lastName = "四";   // 触发 autorun

// ── 测试 2：computed ──

console.log("\n\n【测试 2】computed（有缓存的派生值）\n");

const state = observable({ price: 100, quantity: 3 });
let computeCount = 0;

const total = computed(() => {
  computeCount++;
  return state.price * state.quantity;
});

console.log("  访问 total.value:", total.value, `(计算了 ${computeCount} 次)`);
console.log("  再次访问（缓存）:", total.value, `(计算了 ${computeCount} 次 — 没有重新计算)`);

console.log("\n  修改 price = 200:");
state.price = 200;
console.log("  访问 total.value:", total.value, `(计算了 ${computeCount} 次)`);

// ── 测试 3：autorun + computed 组合 ──

console.log("\n\n【测试 3】autorun + computed 联动\n");

const cart = observable({ price: 50, count: 2 });
const cartTotal = computed(() => cart.price * cart.count);

autorun(() => {
  console.log(`    购物车总价: ${cartTotal.value} 元`);
});

console.log("  修改 count = 5:");
cart.count = 5;

console.log("  修改 price = 30:");
cart.price = 30;

// ── 测试 4：reaction ──

console.log("\n\n【测试 4】reaction（精确追踪）\n");

const settings = observable({ theme: "light", fontSize: 14, language: "zh" });

console.log("  reaction: 只追踪 theme");
reaction(
  () => settings.theme,
  (newTheme, oldTheme) => {
    console.log(`    → theme 变了: ${oldTheme} → ${newTheme}`);
  }
);

console.log("  修改 fontSize = 16（reaction 不追踪，不触发）:");
settings.fontSize = 16;

console.log("  修改 theme = 'dark':");
settings.theme = "dark";

// ── 测试 5：dispose 取消订阅 ──

console.log("\n\n【测试 5】dispose 取消订阅\n");

const counter = observable({ value: 0 });
const dispose = autorun(() => {
  console.log(`    counter = ${counter.value}`);
});

counter.value = 1;
dispose(); // 取消
console.log("  dispose() 后修改:");
counter.value = 2; // 不再触发
console.log("  (没有输出 — 已取消订阅)");

console.log("\n\n=== 面试要点 ===");
console.log("1. MobX 核心 = Proxy 拦截 get/set + 依赖收集（和 Vue 3 响应式原理相同）");
console.log("2. get 时 track（收集当前 effect 到属性的依赖集合）");
console.log("3. set 时 trigger（通知属性的所有依赖 effect 重新执行）");
console.log("4. autorun 立即执行一次收集依赖，后续依赖变化自动重新执行");
console.log("5. computed 惰性 + 缓存：依赖没变不重算，既是 observer 又是 observable");
console.log("6. reaction 分离追踪和执行，比 autorun 更精确控制");
console.log("7. vs Redux: MobX 直接修改状态 + 自动追踪，Redux 手动 dispatch + 手动订阅");
