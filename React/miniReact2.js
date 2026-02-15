// React/mini-react.js
// =============================================================
// 超增强版 Mini React
// 本版本实现：
//
// ✅ 双缓存 Fiber 树（current / workInProgress）
// ✅ 简化 Lane 优先级模型
// ✅ Concurrent 模式（可中断渲染）
// ✅ Hook 链表结构（模拟 React 内部实现）
//
// ⚠ 这是教学实现，目标是帮助理解 React 内部架构
// =============================================================

// =============================================================
// 一、Lane 优先级模型（简化版）
// =============================================================
// React 内部使用 31 bit 表示不同优先级
// 这里我们简化为 3 种

const NoLane = 0b0000;
const SyncLane = 0b0001; // 高优先级（点击）
const InputLane = 0b0010; // 中优先级
const DefaultLane = 0b0100; // 低优先级

function mergeLanes(a, b) {
  return a | b;
}

function getHighestPriorityLane(lanes) {
  return lanes & -lanes; // 取最低位
}

// =============================================================
// 二、Fiber 节点结构（双缓存结构核心）
// =============================================================

function createFiber(node, parent) {
  return {
    type: node.type,
    key: node.key,
    props: node.props,

    // DOM
    stateNode: null,

    // Fiber 结构
    return: parent,
    child: null,
    sibling: null,

    alternate: null, // 指向另一棵树中的对应 fiber（双缓存核心）

    flags: 0,

    lanes: NoLane,

    memoizedState: null, // hook 链表头
    updateQueue: null,
  };
}

// =============================================================
// 三、createElement
// =============================================================

function createElement(type, props, ...children) {
  return {
    type,
    key: props?.key || null,
    props: {
      ...props,
      children: children.flat().map((child) =>
        typeof child === "object"
          ? child
          : {
              type: "TEXT_ELEMENT",
              key: null,
              props: { nodeValue: child, children: [] },
            },
      ),
    },
  };
}

// =============================================================
// 四、Root 结构（current / workInProgress）
// =============================================================

let currentRoot = null; // 当前已经渲染完成的树
let workInProgressRoot = null; // 正在构建的树
let nextUnitOfWork = null;
let pendingLanes = NoLane;

function render(element, container) {
  const rootFiber = {
    type: "ROOT",
    stateNode: container,
    props: { children: [element] },
    alternate: currentRoot,
    child: null,
  };

  if (currentRoot) {
    rootFiber.alternate = currentRoot;
    currentRoot.alternate = rootFiber;
  }

  workInProgressRoot = rootFiber;
  nextUnitOfWork = rootFiber;

  scheduleCallback(DefaultLane);
}

// =============================================================
// 五、调度系统（Concurrent 模式核心）
// =============================================================

function scheduleCallback(lane) {
  pendingLanes = mergeLanes(pendingLanes, lane);

  requestIdleCallback(workLoop);
}

function workLoop(deadline) {
  const lane = getHighestPriorityLane(pendingLanes);

  while (nextUnitOfWork && deadline.timeRemaining() > 1) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork, lane);
  }

  if (!nextUnitOfWork && workInProgressRoot) {
    commitRoot();
    pendingLanes = NoLane;
  }

  if (pendingLanes !== NoLane) {
    requestIdleCallback(workLoop);
  }
}

// =============================================================
// 六、构建 Fiber（可中断）
// =============================================================

function performUnitOfWork(fiber, lane) {
  if (typeof fiber.type === "function") {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) return fiber.child;

  let next = fiber;
  while (next) {
    if (next.sibling) return next.sibling;
    next = next.return;
  }
}

// =============================================================
// 七、Hook 链表结构（模拟 React 内部）
// =============================================================

let currentlyRenderingFiber = null;
let workInProgressHook = null;
let currentHook = null;

function updateFunctionComponent(fiber) {
  currentlyRenderingFiber = fiber;

  // 重置 hook 链表
  workInProgressHook = null;
  currentHook = fiber.alternate?.memoizedState || null;

  fiber.memoizedState = null;

  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function mountWorkInProgressHook() {
  const hook = {
    memoizedState: null,
    queue: null,
    next: null,
  };

  if (!workInProgressHook) {
    currentlyRenderingFiber.memoizedState = hook;
  } else {
    workInProgressHook.next = hook;
  }

  workInProgressHook = hook;
  return hook;
}

function updateWorkInProgressHook() {
  const hook = {
    memoizedState: currentHook.memoizedState,
    queue: currentHook.queue,
    next: null,
  };

  if (!workInProgressHook) {
    currentlyRenderingFiber.memoizedState = hook;
  } else {
    workInProgressHook.next = hook;
  }

  workInProgressHook = hook;
  currentHook = currentHook.next;
  return hook;
}

// =============================================================
// 八、useState（基于 Hook 链表）
// =============================================================

function useState(initialState) {
  let hook;

  if (!currentHook) {
    hook = mountWorkInProgressHook();
    hook.memoizedState = initialState;
    hook.queue = [];
  } else {
    hook = updateWorkInProgressHook();
  }

  hook.queue.forEach((action) => {
    hook.memoizedState = typeof action === "function" ? action(hook.memoizedState) : action;
  });

  const dispatch = (action) => {
    hook.queue.push(action);

    workInProgressRoot = {
      ...currentRoot,
      alternate: currentRoot,
    };

    nextUnitOfWork = workInProgressRoot;
    scheduleCallback(SyncLane);
  };

  return [hook.memoizedState, dispatch];
}

// =============================================================
// 九、Host 组件
// =============================================================

function updateHostComponent(fiber) {
  if (!fiber.stateNode) {
    fiber.stateNode = fiber.type === "TEXT_ELEMENT" ? document.createTextNode("") : document.createElement(fiber.type);
  }

  reconcileChildren(fiber, fiber.props.children);
}

// =============================================================
// 十、Reconciliation
// =============================================================

function reconcileChildren(wipFiber, elements) {
  let oldFiber = wipFiber.alternate?.child;
  let prevSibling = null;

  elements.forEach((element, index) => {
    const newFiber = createFiber(element, wipFiber);

    if (index === 0) {
      wipFiber.child = newFiber;
    } else {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
  });
}

// =============================================================
// 十一、Commit 阶段（双缓存切换）
// =============================================================

function commitRoot() {
  commitWork(workInProgressRoot.child);

  // 双缓存切换：wip 变 current
  currentRoot = workInProgressRoot;
  workInProgressRoot = null;
}

function commitWork(fiber) {
  if (!fiber) return;

  let parentFiber = fiber.return;
  while (!parentFiber.stateNode) {
    parentFiber = parentFiber.return;
  }

  parentFiber.stateNode.appendChild(fiber.stateNode);

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

// =============================================================
// 导出
// =============================================================

const MiniReact = {
  createElement,
  render,
  useState,
};

export default MiniReact;
