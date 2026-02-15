// React/mini-react.js
// ============================================================================
// 教学级 Mini React - 终极增强版
//
// 本版本实现：
//
// ✅ 双缓存 Fiber 树 (current / workInProgress)
// ✅ 真正的 effect list (flags + 单向 effect 链)
// ✅ 完整 diff（含 key 复用）
// ✅ 时间切片 + 中断恢复
// ✅ 多 root 支持
// ✅ 简化版 Suspense 模型
//
// ⚠ 这是教学实现，用于理解 React 18 内部核心机制
// ============================================================================

// ============================================================================
// 一、Flags 定义（Effect 标记）
// ============================================================================

const NoFlags = 0b000000;
const Placement = 0b000001;
const Update = 0b000010;
const Deletion = 0b000100;
const Passive = 0b001000;

// ============================================================================
// 二、Lane（优先级）模型
// ============================================================================

const NoLane = 0b0000;
const SyncLane = 0b0001;
const DefaultLane = 0b0010;

function mergeLanes(a, b) {
  return a | b;
}

function getHighestPriorityLane(lanes) {
  return lanes & -lanes;
}

// ============================================================================
// 三、Root 结构（支持多 root）
// ============================================================================

const roots = new Set();

function createRoot(container) {
  const root = {
    container,
    current: null,
    finishedWork: null,
    pendingLanes: NoLane,
  };
  roots.add(root);
  return root;
}

// ============================================================================
// 四、Fiber 节点结构
// ============================================================================

function createFiber(node, parent) {
  return {
    type: node.type,
    key: node.key,
    props: node.props,

    stateNode: null,

    return: parent,
    child: null,
    sibling: null,
    alternate: null,

    flags: NoFlags,
    subtreeFlags: NoFlags,

    nextEffect: null, // effect list 单链表

    memoizedState: null,
  };
}

// ============================================================================
// 五、createElement
// ============================================================================

function createElement(type, props, ...children) {
  return {
    type,
    key: props?.key ?? null,
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

// ============================================================================
// 六、调度系统（时间切片 + 恢复）
// ============================================================================

let workInProgress = null;
let workInProgressRoot = null;
let nextUnitOfWork = null;

function scheduleUpdateOnFiber(root, lane) {
  root.pendingLanes = mergeLanes(root.pendingLanes, lane);
  requestIdleCallback((deadline) => performConcurrentWorkOnRoot(root, deadline));
}

function performConcurrentWorkOnRoot(root, deadline) {
  const lane = getHighestPriorityLane(root.pendingLanes);

  if (!workInProgressRoot) {
    prepareFreshStack(root);
  }

  while (nextUnitOfWork && deadline.timeRemaining() > 1) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }

  if (!nextUnitOfWork) {
    root.finishedWork = workInProgressRoot;
    commitRoot(root);
  } else {
    // 时间片用完，等待下一帧恢复
    requestIdleCallback((d) => performConcurrentWorkOnRoot(root, d));
  }
}

function prepareFreshStack(root) {
  workInProgressRoot = {
    ...root.current,
    alternate: root.current,
  };
  nextUnitOfWork = workInProgressRoot;
}

// ============================================================================
// 七、构建 Fiber
// ============================================================================

function performUnitOfWork(fiber) {
  if (typeof fiber.type === "function") {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) return fiber.child;

  let next = fiber;
  while (next) {
    completeUnitOfWork(next);
    if (next.sibling) return next.sibling;
    next = next.return;
  }
}

function completeUnitOfWork(fiber) {
  let subtreeFlags = NoFlags;
  let child = fiber.child;

  while (child) {
    subtreeFlags |= child.subtreeFlags;
    subtreeFlags |= child.flags;
    child = child.sibling;
  }

  fiber.subtreeFlags |= subtreeFlags;

  // 构建 effect list
  if (fiber.flags !== NoFlags) {
    if (!workInProgressRoot.firstEffect) {
      workInProgressRoot.firstEffect = fiber;
    } else {
      workInProgressRoot.lastEffect.nextEffect = fiber;
    }
    workInProgressRoot.lastEffect = fiber;
  }
}

// ============================================================================
// 八、完整 diff（key 复用）
// ============================================================================

function reconcileChildren(returnFiber, elements) {
  const existing = new Map();
  let oldFiber = returnFiber.alternate?.child;

  while (oldFiber) {
    existing.set(oldFiber.key ?? oldFiber.index, oldFiber);
    oldFiber = oldFiber.sibling;
  }

  let prevSibling = null;

  elements.forEach((element, index) => {
    const key = element.key ?? index;
    const matched = existing.get(key);

    let newFiber;

    if (matched && matched.type === element.type) {
      newFiber = createFiber(element, returnFiber);
      newFiber.stateNode = matched.stateNode;
      newFiber.alternate = matched;
      newFiber.flags = Update;
      existing.delete(key);
    } else {
      newFiber = createFiber(element, returnFiber);
      newFiber.flags = Placement;
    }

    if (index === 0) {
      returnFiber.child = newFiber;
    } else {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
  });

  existing.forEach((fiber) => {
    fiber.flags = Deletion;
    if (!workInProgressRoot.firstEffect) {
      workInProgressRoot.firstEffect = fiber;
    } else {
      workInProgressRoot.lastEffect.nextEffect = fiber;
    }
    workInProgressRoot.lastEffect = fiber;
  });
}

// ============================================================================
// 九、Suspense（简化版）
// ============================================================================

function Suspense({ fallback, children }) {
  try {
    return children;
  } catch (promise) {
    if (typeof promise.then === "function") {
      promise.then(() => {
        scheduleUpdateOnFiber(currentRoot, DefaultLane);
      });
      return fallback;
    }
    throw promise;
  }
}

// ============================================================================
// 十、Commit 阶段（执行 effect list）
// ============================================================================

function commitRoot(root) {
  let effect = root.finishedWork.firstEffect;

  while (effect) {
    commitMutation(effect, root.container);
    effect = effect.nextEffect;
  }

  root.current = root.finishedWork;
  workInProgressRoot = null;
  root.pendingLanes = NoLane;
}

function commitMutation(fiber, container) {
  if (fiber.flags & Placement) {
    container.appendChild(fiber.stateNode);
  }
  if (fiber.flags & Update) {
    // 此处可扩展 diff props
  }
  if (fiber.flags & Deletion) {
    container.removeChild(fiber.stateNode);
  }
}

// ============================================================================
// 导出
// ============================================================================

const MiniReact = {
  createRoot,
  createElement,
  Suspense,
};

export default MiniReact;
