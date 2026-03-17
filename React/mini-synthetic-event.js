/**
 * React 合成事件系统实现
 *
 * ═══════════════════════════════════════════════════════
 *  为什么 React 要自己实现事件系统？
 * ═══════════════════════════════════════════════════════
 *
 * 1. 跨浏览器兼容：抹平浏览器差异（IE 的 attachEvent vs addEventListener）
 * 2. 事件委托性能：不在每个 DOM 上绑事件，统一委托到 root 节点
 * 3. 可控的执行顺序：保证 setState 的批量更新（在事件回调中合并多次 setState）
 * 4. 优先级调度集成：React 18 中事件触发的更新有不同优先级
 *
 * ═══════════════════════════════════════════════════════
 *  React 16 vs 17 vs 18 的事件委托
 * ═══════════════════════════════════════════════════════
 *
 *  React 16：事件委托到 document
 *    document.addEventListener('click', dispatchEvent)
 *    问题：多个 React 根节点共用 document → 事件冲突
 *
 *  React 17+：事件委托到 root 容器
 *    rootContainer.addEventListener('click', dispatchEvent)
 *    好处：每个 root 独立，微前端场景不冲突
 *
 * ═══════════════════════════════════════════════════════
 *  事件池（React 16 有，React 17 移除）
 * ═══════════════════════════════════════════════════════
 *
 *  React 16 中合成事件对象是复用的（对象池模式）：
 *    回调执行完后，event 的所有属性被重置为 null
 *    如果在 setTimeout 中访问 event.target → null！
 *    需要调用 e.persist() 阻止回收
 *
 *  React 17 移除了事件池 → 不再需要 persist()
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. SyntheticEvent      — 合成事件对象（包装原生事件）
 *  2. EventPlugin         — 事件注册（将 onClick 映射到 click）
 *  3. 事件委托            — 在 root 上统一监听
 *  4. 事件分发            — 从 target 沿 Fiber 树向上收集回调
 *  5. 冒泡 + 捕获         — 模拟完整的事件传播
 *
 * 运行方式：node React/mini-synthetic-event.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、SyntheticEvent — 合成事件
// ═══════════════════════════════════════════════════════════════════════════
//
// 合成事件 = 对原生事件的包装
// 统一接口：不管什么浏览器，e.target、e.preventDefault() 行为一致

class SyntheticEvent {
  constructor(nativeEvent) {
    this.nativeEvent = nativeEvent;
    this.type = nativeEvent.type;
    this.target = nativeEvent.target;
    this.currentTarget = null;        // 会在分发时动态设置
    this.bubbles = nativeEvent.bubbles;

    this._isPropagationStopped = false;
    this._isDefaultPrevented = false;
  }

  preventDefault() {
    this._isDefaultPrevented = true;
    // 同时阻止原生事件的默认行为
    if (this.nativeEvent.preventDefault) {
      this.nativeEvent.preventDefault();
    }
  }

  stopPropagation() {
    this._isPropagationStopped = true;
    if (this.nativeEvent.stopPropagation) {
      this.nativeEvent.stopPropagation();
    }
  }

  isPropagationStopped() {
    return this._isPropagationStopped;
  }

  isDefaultPrevented() {
    return this._isDefaultPrevented;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、事件名映射
// ═══════════════════════════════════════════════════════════════════════════
//
// React 的 props 名称 → 原生事件名
//   onClick      → click
//   onClickCapture → click（捕获阶段）
//   onChange     → input（React 的 onChange 实际上监听的是 input 事件！）

const eventNameMap = {
  onClick: "click",
  onClickCapture: "click",
  onChange: "input",  // React 把 onChange 映射到 input 事件（实时触发）
  onChangeCapture: "input",
  onMouseDown: "mousedown",
  onMouseUp: "mouseup",
  onKeyDown: "keydown",
  onKeyUp: "keyup",
  onFocus: "focus",
  onBlur: "blur",
};

function isCapture(propName) {
  return propName.endsWith("Capture");
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、模拟 Fiber 树 + DOM 树
// ═══════════════════════════════════════════════════════════════════════════
//
// 真实 React 中：DOM 节点通过 __reactFiber$ 属性指向对应的 Fiber
// 这里模拟一个简单的 Fiber 树

function createFiberNode(type, props, parent) {
  return {
    type,
    props: props || {},
    return: parent, // 父 Fiber
    stateNode: null, // 对应的 DOM 节点（简化：用 type 标识）
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、事件委托 + 分发
// ═══════════════════════════════════════════════════════════════════════════
//
// React 的事件分发流程：
//
//   1. 原生事件触发 → root 上的统一 listener 被调用
//   2. 从 event.target 对应的 Fiber 开始，沿 return（父节点）向上遍历
//   3. 收集路径上所有 Fiber 的事件回调（分捕获和冒泡两个数组）
//   4. 先执行捕获回调（从外到内），再执行冒泡回调（从内到外）
//   5. 任何回调中调用 stopPropagation() → 后续回调不再执行

class EventSystem {
  constructor(rootFiber) {
    this.rootFiber = rootFiber;
    this.registeredEvents = new Set();
  }

  /**
   * 注册事件委托
   * 真实 React：在 createRoot 时就把所有支持的事件都注册到 root 上
   */
  listenToEvent(eventName) {
    if (this.registeredEvents.has(eventName)) return;
    this.registeredEvents.add(eventName);
    // 真实实现：root DOM.addEventListener(eventName, this.dispatch.bindx)
    console.log(`  [EventSystem] 注册委托: ${eventName} → root`);
  }

  /**
   * 从 target Fiber 收集事件处理路径
   *
   * 从目标节点沿 Fiber 树向上走到 root：
   *   收集 onClickCapture → 放入 captureListeners（从外到内 = unshift）
   *   收集 onClick → 放入 bubbleListeners（从内到外 = push）
   */
  collectListeners(targetFiber, reactEventName) {
    const captureListeners = [];
    const bubbleListeners = [];
    const captureName = reactEventName + "Capture";

    let fiber = targetFiber;
    while (fiber) {
      if (fiber.props[captureName]) {
        // 捕获回调从外到内执行 → 外层的先 push，后面反转
        captureListeners.unshift({ fiber, handler: fiber.props[captureName] });
      }
      if (fiber.props[reactEventName]) {
        // 冒泡回调从内到外执行 → 内层先 push
        bubbleListeners.push({ fiber, handler: fiber.props[reactEventName] });
      }
      fiber = fiber.return;
    }

    return { captureListeners, bubbleListeners };
  }

  /**
   * 分发事件
   *
   * 完整流程：
   *   捕获阶段（外 → 内）→ 到达目标 → 冒泡阶段（内 → 外）
   */
  dispatch(targetFiber, nativeEvent, reactEventName) {
    const syntheticEvent = new SyntheticEvent(nativeEvent);
    const { captureListeners, bubbleListeners } = this.collectListeners(targetFiber, reactEventName);

    // ── 捕获阶段（从外到内）──
    for (const { fiber, handler } of captureListeners) {
      if (syntheticEvent.isPropagationStopped()) break;
      syntheticEvent.currentTarget = fiber.type;
      handler(syntheticEvent);
    }

    // ── 冒泡阶段（从内到外）──
    for (const { fiber, handler } of bubbleListeners) {
      if (syntheticEvent.isPropagationStopped()) break;
      syntheticEvent.currentTarget = fiber.type;
      handler(syntheticEvent);
    }

    return syntheticEvent;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== React 合成事件系统演示 ===\n");

// ── 构建模拟 Fiber 树 ──
//
//   div#root (rootFiber)
//     └── div.container (containerFiber)  onClick + onClickCapture
//           └── div.inner (innerFiber)    onClick
//                 └── button (buttonFiber) onClick

const rootFiber = createFiberNode("div#root", {});
const containerFiber = createFiberNode("div.container", {
  onClickCapture: (e) => console.log(`    [捕获] div.container onClickCapture (currentTarget: ${e.currentTarget})`),
  onClick: (e) => console.log(`    [冒泡] div.container onClick (currentTarget: ${e.currentTarget})`),
}, rootFiber);
const innerFiber = createFiberNode("div.inner", {
  onClick: (e) => console.log(`    [冒泡] div.inner onClick (currentTarget: ${e.currentTarget})`),
}, containerFiber);
const buttonFiber = createFiberNode("button", {
  onClick: (e) => console.log(`    [冒泡] button onClick (currentTarget: ${e.currentTarget})`),
}, innerFiber);

const eventSystem = new EventSystem(rootFiber);

// ── 测试 1：正常冒泡 ──

console.log("【测试 1】正常事件冒泡 + 捕获\n");
console.log("  Fiber 树: root > container(onClick+Capture) > inner(onClick) > button(onClick)");
console.log("  点击 button:\n");

eventSystem.dispatch(buttonFiber, { type: "click", target: "button", bubbles: true }, "onClick");

// ── 测试 2：stopPropagation ──

console.log("\n\n【测试 2】stopPropagation 阻止冒泡\n");

const stopFiber = createFiberNode("button-stop", {
  onClick: (e) => {
    console.log(`    [冒泡] button-stop onClick → 调用 stopPropagation()`);
    e.stopPropagation();
  },
}, innerFiber);

console.log("  点击 button-stop（在 onClick 中 stopPropagation）:\n");
eventSystem.dispatch(stopFiber, { type: "click", target: "button-stop", bubbles: true }, "onClick");
console.log("    (container 和 inner 的 onClick 不再触发)");

// ── 测试 3：SyntheticEvent ──

console.log("\n\n【测试 3】SyntheticEvent 合成事件对象\n");

const se = new SyntheticEvent({
  type: "click",
  target: "button",
  bubbles: true,
  preventDefault: () => {},
  stopPropagation: () => {},
});

console.log("  type:", se.type);
console.log("  target:", se.target);
console.log("  nativeEvent:", se.nativeEvent.type, "(可访问原生事件)");
se.preventDefault();
console.log("  preventDefault() → isDefaultPrevented:", se.isDefaultPrevented());

// ── 测试 4：React vs 原生事件差异 ──

console.log("\n\n【测试 4】React 事件 vs 原生事件 (知识点)\n");

const differences = [
  ["事件绑定", "每个 DOM 单独绑定", "委托到 root (React 17+) 或 document (React 16)"],
  ["事件对象", "原生 Event", "SyntheticEvent（包装了原生事件）"],
  ["命名", "onclick (全小写)", "onClick (驼峰)"],
  ["阻止默认", "return false 可行", "必须 e.preventDefault()"],
  ["onChange", "blur 时触发", "input 时实时触发（映射到 input 事件）"],
  ["this 指向", "DOM 元素", "undefined（需要 bind 或箭头函数）"],
  ["事件池", "无", "React 16 有（复用对象），React 17 移除"],
];

console.log("  " + "React 事件".padEnd(22) + "原生事件".padEnd(28) + "说明");
console.log("  " + "─".repeat(70));
differences.forEach(([topic, native, react]) => {
  console.log(`  ${topic.padEnd(14)}${native.padEnd(30)}${react}`);
});

console.log("\n\n=== 面试要点 ===");
console.log("1. React 事件委托到 root（v17+），不是每个 DOM 单独绑定 → 性能好");
console.log("2. 合成事件 SyntheticEvent 包装原生事件，跨浏览器兼容");
console.log("3. 事件分发：从 target Fiber 向上收集回调 → 先捕获(外→内) → 后冒泡(内→外)");
console.log("4. onChange 映射到 input 事件（实时触发），这是 React 的特殊行为");
console.log("5. React 16 有事件池（回调后属性置 null），React 17 移除 → 不再需要 e.persist()");
console.log("6. stopPropagation 同时阻止合成事件和原生事件的传播");
console.log("7. React 事件和原生事件混用时注意执行顺序：原生先于合成（因为委托在 root）");
