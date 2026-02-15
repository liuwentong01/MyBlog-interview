// React/mini-react.js
// ==============================
// 一个增强版 Mini React
// 新增能力：
// ✅ useEffect
// ✅ key diff
// ✅ 简单 DOM diff 优化
// ✅ 批量更新（异步调度合并）
// ==============================

// ======================================================
// 1. createElement
// ======================================================

function createElement(type, props, ...children) {
  return {
    type,
    key: props?.key || null,
    props: {
      ...props,
      children: children.flat().map((child) => (typeof child === "object" ? child : createTextElement(child))),
    },
  };
}

function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    key: null,
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

// ======================================================
// 2. DOM 创建 & diff 优化
// ======================================================

function createDom(fiber) {
  const dom = fiber.type === "TEXT_ELEMENT" ? document.createTextNode("") : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}

const isEvent = (key) => key.startsWith("on");
const isProperty = (key) => key !== "children" && key !== "key" && !isEvent(key);

function updateDom(dom, prevProps, nextProps) {
  // 移除旧事件
  Object.keys(prevProps)
    .filter(isEvent)
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      if (!(name in nextProps) || prevProps[name] !== nextProps[name]) {
        dom.removeEventListener(eventType, prevProps[name]);
      }
    });

  // 移除旧属性
  Object.keys(prevProps)
    .filter(isProperty)
    .forEach((name) => {
      if (!(name in nextProps)) {
        dom[name] = "";
      }
    });

  // 设置新属性
  Object.keys(nextProps)
    .filter(isProperty)
    .forEach((name) => {
      if (prevProps[name] !== nextProps[name]) {
        dom[name] = nextProps[name];
      }
    });

  // 添加新事件
  Object.keys(nextProps)
    .filter(isEvent)
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      if (prevProps[name] !== nextProps[name]) {
        dom.addEventListener(eventType, nextProps[name]);
      }
    });
}

// ======================================================
// 3. Fiber 调度 + 批量更新
// ======================================================

let nextUnitOfWork = null;
let currentRoot = null;
let wipRoot = null;
let deletions = [];
let effectQueue = [];
let isBatching = false;

function render(element, container) {
  wipRoot = {
    dom: container,
    props: { children: [element] },
    alternate: currentRoot,
  };
  nextUnitOfWork = wipRoot;
  deletions = [];
}

function scheduleUpdate() {
  if (isBatching) return;
  isBatching = true;
  Promise.resolve().then(() => {
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
    isBatching = false;
  });
}

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;

  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) return fiber.child;
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) return nextFiber.sibling;
    nextFiber = nextFiber.parent;
  }
}

// ======================================================
// 4. Hooks: useState + useEffect
// ======================================================

let wipFiber = null;
let hookIndex = 0;

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];

  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState(initial) {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];

  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  oldHook?.queue.forEach((action) => {
    hook.state = typeof action === "function" ? action(hook.state) : action;
  });

  const setState = (action) => {
    hook.queue.push(action);
    scheduleUpdate();
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

function useEffect(effect, deps) {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];

  const hasChanged = !oldHook || !deps || deps.some((dep, i) => dep !== oldHook.deps[i]);

  const hook = {
    effect,
    deps,
    cleanup: oldHook?.cleanup,
  };

  if (hasChanged) {
    effectQueue.push(hook);
  }

  wipFiber.hooks.push(hook);
  hookIndex++;
}

// ======================================================
// 5. Key Diff + 优化 reconcile
// ======================================================

function updateHostComponent(fiber) {
  if (!fiber.dom) fiber.dom = createDom(fiber);
  reconcileChildren(fiber, fiber.props.children);
}

function reconcileChildren(wipFiber, elements) {
  const oldFibers = {};
  let oldFiber = wipFiber.alternate?.child;

  while (oldFiber) {
    const key = oldFiber.key || oldFiber.index;
    oldFibers[key] = oldFiber;
    oldFiber = oldFiber.sibling;
  }

  let prevSibling = null;

  elements.forEach((element, index) => {
    const key = element.key || index;
    const oldFiber = oldFibers[key];
    let newFiber = null;

    if (oldFiber && element.type === oldFiber.type) {
      newFiber = {
        type: oldFiber.type,
        key,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      };
      delete oldFibers[key];
    } else {
      newFiber = {
        type: element.type,
        key,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
  });

  Object.values(oldFibers).forEach((fiber) => {
    fiber.effectTag = "DELETION";
    deletions.push(fiber);
  });
}

// ======================================================
// 6. Commit 阶段
// ======================================================

function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;

  // 执行 effect
  effectQueue.forEach((hook) => {
    hook.cleanup?.();
    hook.cleanup = hook.effect();
  });
  effectQueue = [];
}

function commitWork(fiber) {
  if (!fiber) return;

  let domParentFiber = fiber.parent;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }

  const domParent = domParentFiber.dom;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

// ======================================================
// 7. 导出
// ======================================================

const MiniReact = {
  createElement,
  render,
  useState,
  useEffect,
};

export default MiniReact;
