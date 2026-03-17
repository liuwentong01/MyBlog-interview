/**
 * Mini Scheduler — React 调度器实现
 *
 * ═══════════════════════════════════════════════════════
 *  为什么 React 需要自己的调度器？
 * ═══════════════════════════════════════════════════════
 *
 * 浏览器主线程是单线程的，JS 执行、布局、绘制都在同一个线程：
 *
 *   |--- JS 执行 ---|--- 布局 ---|--- 绘制 ---|--- JS ---|--- 布局 ---|...
 *   └──── 一帧（16.6ms @60fps）────┘
 *
 * 如果 JS 执行时间太长（比如一次性渲染 10000 个节点）：
 *
 *   |----------- JS 长任务 (200ms) -----------|--- 布局 ---|--- 绘制 ---|
 *   └──── 200ms 内页面完全卡死，无法响应用户操作 ────┘
 *
 * React Scheduler 的解决方案：
 *   1. 时间切片：把长任务拆成多个小任务，每个只执行 5ms
 *   2. 优先级：紧急任务（用户输入）优先执行，不紧急的（数据预取）延后
 *   3. 可中断：高优先级任务到来时，暂停当前低优先级任务
 *
 * ═══════════════════════════════════════════════════════
 *  React 的 5 个优先级
 * ═══════════════════════════════════════════════════════
 *
 *  优先级              超时时间    场景
 *  ImmediatePriority   -1ms       同步任务（已过期，立即执行）
 *  UserBlockingPriority 250ms     用户交互（点击、输入）
 *  NormalPriority       5000ms    普通更新（数据请求回调）
 *  LowPriority          10000ms  低优先级（数据预取）
 *  IdlePriority         永不超时  空闲时才执行
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. 最小堆（优先级队列）— 按过期时间排序
 *  2. scheduleCallback    — 调度一个任务
 *  3. workLoop            — 主循环（时间切片 + 优先级调度）
 *  4. MessageChannel      — 异步调度（替代 setTimeout 0）
 *
 * 运行方式：node React/mini-scheduler.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、优先级定义
// ═══════════════════════════════════════════════════════════════════════════

const ImmediatePriority = 1;
const UserBlockingPriority = 2;
const NormalPriority = 3;
const LowPriority = 4;
const IdlePriority = 5;

// 每个优先级对应的超时时间
// 任务被调度后，过了超时时间还没执行 → 变为"过期"，必须立即执行
const IMMEDIATE_TIMEOUT = -1;
const USER_BLOCKING_TIMEOUT = 250;
const NORMAL_TIMEOUT = 5000;
const LOW_TIMEOUT = 10000;
const IDLE_TIMEOUT = 1073741823; // 约 12 天，相当于永不超时

function getTimeoutByPriority(priority) {
  switch (priority) {
    case ImmediatePriority: return IMMEDIATE_TIMEOUT;
    case UserBlockingPriority: return USER_BLOCKING_TIMEOUT;
    case NormalPriority: return NORMAL_TIMEOUT;
    case LowPriority: return LOW_TIMEOUT;
    case IdlePriority: return IDLE_TIMEOUT;
    default: return NORMAL_TIMEOUT;
  }
}

const priorityNames = {
  [ImmediatePriority]: "Immediate",
  [UserBlockingPriority]: "UserBlocking",
  [NormalPriority]: "Normal",
  [LowPriority]: "Low",
  [IdlePriority]: "Idle",
};

// ═══════════════════════════════════════════════════════════════════════════
// 二、最小堆（MinHeap）
// ═══════════════════════════════════════════════════════════════════════════
//
// 为什么用堆而不是数组排序？
//   - 任务队列频繁插入和取最小值
//   - 数组排序：插入 O(n log n)，取最小 O(1)
//   - 最小堆：插入 O(log n)，取最小 O(1)
//
// React 源码中叫 SchedulerMinHeap.js，和这里实现完全一致

function push(heap, node) {
  heap.push(node);
  siftUp(heap, node, heap.length - 1);
}

function peek(heap) {
  return heap.length > 0 ? heap[0] : null;
}

function pop(heap) {
  if (heap.length === 0) return null;
  const first = heap[0];
  const last = heap.pop();
  if (last !== first) {
    heap[0] = last;
    siftDown(heap, last, 0);
  }
  return first;
}

// 上浮：新节点和父节点比较，小的上移
function siftUp(heap, node, i) {
  let index = i;
  while (index > 0) {
    const parentIndex = (index - 1) >>> 1; // 等价于 Math.floor((index-1)/2)
    const parent = heap[parentIndex];
    if (compare(parent, node) > 0) {
      // 父节点更大 → 交换
      heap[parentIndex] = node;
      heap[index] = parent;
      index = parentIndex;
    } else {
      break;
    }
  }
}

// 下沉：从根开始和子节点比较，大的下移
function siftDown(heap, node, i) {
  let index = i;
  const length = heap.length;
  const halfLength = length >>> 1;

  while (index < halfLength) {
    const leftIndex = (index + 1) * 2 - 1;
    const left = heap[leftIndex];
    const rightIndex = leftIndex + 1;
    const right = rightIndex < length ? heap[rightIndex] : null;

    // 选左右子节点中更小的那个
    if (compare(left, node) < 0) {
      if (right !== null && compare(right, left) < 0) {
        heap[index] = right;
        heap[rightIndex] = node;
        index = rightIndex;
      } else {
        heap[index] = left;
        heap[leftIndex] = node;
        index = leftIndex;
      }
    } else if (right !== null && compare(right, node) < 0) {
      heap[index] = right;
      heap[rightIndex] = node;
      index = rightIndex;
    } else {
      break;
    }
  }
}

// 比较函数：先比较 sortIndex（过期时间），相同则比较 id（先入先出）
function compare(a, b) {
  const diff = a.sortIndex - b.sortIndex;
  return diff !== 0 ? diff : a.id - b.id;
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、Scheduler 核心
// ═══════════════════════════════════════════════════════════════════════════

const taskQueue = [];      // 就绪队列（已过期或即将执行的任务）
const timerQueue = [];     // 延迟队列（还没到开始时间的任务）
let taskIdCounter = 1;
let isHostCallbackScheduled = false;
let currentTask = null;

// 时间切片：每个时间片 5ms（React 源码中的值）
const FRAME_YIELD_MS = 5;
let deadline = 0;

function getCurrentTime() {
  return Date.now();
}

function shouldYield() {
  return getCurrentTime() >= deadline;
}

/**
 * scheduleCallback — 调度一个任务
 *
 * 这是 Scheduler 的入口。React 中 setState 最终会调用到这里。
 *
 * 流程：
 *   1. 根据优先级计算 expirationTime（过期时间）
 *   2. 创建 task 对象
 *   3. 如果任务有 delay → 放入 timerQueue（延迟队列）
 *      如果任务没有 delay → 放入 taskQueue（就绪队列）
 *   4. 触发 workLoop 执行
 */
function scheduleCallback(priority, callback, options) {
  const currentTime = getCurrentTime();
  const startTime = (options && options.delay) ? currentTime + options.delay : currentTime;
  const timeout = getTimeoutByPriority(priority);
  const expirationTime = startTime + timeout;

  const task = {
    id: taskIdCounter++,
    callback,
    priorityLevel: priority,
    startTime,
    expirationTime,
    sortIndex: -1, // 用于堆排序
  };

  if (startTime > currentTime) {
    // 延迟任务：还没到执行时间
    task.sortIndex = startTime;
    push(timerQueue, task);
    // 真实实现中会设置定时器，到时间后将任务从 timerQueue 移到 taskQueue
  } else {
    // 就绪任务：可以立即执行
    task.sortIndex = expirationTime; // 按过期时间排序（越早过期越优先）
    push(taskQueue, task);
  }

  // 触发 workLoop
  if (!isHostCallbackScheduled) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }

  return task;
}

/**
 * workLoop — 核心调度循环
 *
 * 按优先级（过期时间）依次执行任务，同时实现时间切片：
 *   - 每次循环检查 shouldYield()
 *   - 如果时间片用完 → 中断循环，让出主线程
 *   - 浏览器处理完布局/绘制/事件后 → 回来继续执行
 *
 * 任务的 callback 可以返回一个新函数（continuation）：
 *   - 返回函数 → 说明任务没做完，下次继续
 *   - 返回 null → 任务完成，从队列移除
 *   这就是 React Fiber 的可中断渲染：performConcurrentWorkOnRoot 返回自身表示未完成
 */
function workLoop(initialTime) {
  let currentTime = initialTime;
  // 把到时间的延迟任务移到就绪队列
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);

  while (currentTask !== null) {
    // 任务还没过期，且时间片用完 → 中断
    if (currentTask.expirationTime > currentTime && shouldYield()) {
      break;
    }

    const callback = currentTask.callback;
    if (typeof callback === "function") {
      currentTask.callback = null;
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;

      // 执行任务，传入是否已超时（React 用这个决定是否要同步完成剩余工作）
      const continuationCallback = callback(didUserCallbackTimeout);

      currentTime = getCurrentTime();

      if (typeof continuationCallback === "function") {
        // 任务没完成 → 保留在队列中，下次继续
        currentTask.callback = continuationCallback;
      } else {
        // 任务完成 → 从队列移除
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }

      advanceTimers(currentTime);
    } else {
      // callback 已被清空（任务被取消）
      pop(taskQueue);
    }

    currentTask = peek(taskQueue);
  }

  // 返回是否还有剩余任务（用于决定是否需要继续调度）
  return currentTask !== null;
}

// 将到时间的延迟任务移到就绪队列
function advanceTimers(currentTime) {
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      pop(timerQueue); // 被取消的任务
    } else if (timer.startTime <= currentTime) {
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer); // 到时间了，移入就绪队列
    } else {
      break; // 最早的都没到时间，后面的更不用看
    }
    timer = peek(timerQueue);
  }
}

function flushWork(initialTime) {
  isHostCallbackScheduled = false;
  const hasMore = workLoop(initialTime);
  if (hasMore) {
    // 还有任务 → 继续调度
    requestHostCallback(flushWork);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、requestHostCallback — 异步调度
// ═══════════════════════════════════════════════════════════════════════════
//
// 为什么用 MessageChannel 而不是 setTimeout？
//
//   setTimeout(fn, 0) 实际延迟约 4ms（浏览器最小延迟）
//   MessageChannel 延迟约 0-1ms
//
//   对于 5ms 的时间片来说，4ms 的开销浪费了 80% 的调度时间
//   MessageChannel 几乎没有额外延迟
//
// 为什么不用 requestAnimationFrame？
//   rAF 与屏幕刷新率绑定（16.6ms），不够灵活
//   且在后台标签页中会暂停
//
// 在 Node.js 环境中用 setTimeout 模拟（没有 MessageChannel）

let scheduledCallback = null;

function requestHostCallback(callback) {
  scheduledCallback = callback;
  // 在 Node.js 中用 setTimeout 模拟 MessageChannel
  // 浏览器中应该用 MessageChannel
  setTimeout(() => {
    deadline = getCurrentTime() + FRAME_YIELD_MS; // 设置当前时间片的截止时间
    if (scheduledCallback) {
      scheduledCallback(getCurrentTime());
    }
  }, 0);
}

// 取消任务
function cancelCallback(task) {
  // 不从堆中移除（移除要 O(n)），只是把 callback 置空
  // workLoop 遇到 callback 为 null 的任务会直接跳过
  task.callback = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini Scheduler 演示 ===\n");

// ── 测试 1：最小堆 ──

console.log("【测试 1】最小堆\n");

const heap = [];
push(heap, { id: 1, sortIndex: 5 });
push(heap, { id: 2, sortIndex: 1 });
push(heap, { id: 3, sortIndex: 3 });
push(heap, { id: 4, sortIndex: 2 });
push(heap, { id: 5, sortIndex: 4 });

const order = [];
while (heap.length) {
  order.push(pop(heap).sortIndex);
}
console.log("  出堆顺序:", order); // [1, 2, 3, 4, 5]
console.log("  是否有序:", JSON.stringify(order) === "[1,2,3,4,5]" ? "PASS" : "FAIL");

// ── 测试 2：优先级调度 ──

console.log("\n【测试 2】优先级调度（同步模拟）\n");

// 模拟同步执行所有任务（不用真正的异步调度）
const executionLog = [];

function runAllSync() {
  deadline = getCurrentTime() + 1000; // 给足够的时间
  advanceTimers(getCurrentTime());
  while (peek(taskQueue)) {
    const task = peek(taskQueue);
    if (task.callback) {
      executionLog.push({
        id: task.id,
        priority: priorityNames[task.priorityLevel],
      });
      task.callback = null;
    }
    pop(taskQueue);
  }
  isHostCallbackScheduled = false;
  taskIdCounter = 1;
}

// 按不同顺序调度，看执行是否按优先级
scheduleCallback(NormalPriority, () => {});     // 正常
scheduleCallback(ImmediatePriority, () => {});  // 最高
scheduleCallback(LowPriority, () => {});        // 低
scheduleCallback(UserBlockingPriority, () => {}); // 用户交互

runAllSync();

console.log("  调度顺序: Normal → Immediate → Low → UserBlocking");
console.log("  执行顺序:", executionLog.map((t) => `${t.priority}(#${t.id})`).join(" → "));
console.log("  (Immediate 最先执行，Low 最后)");

// ── 测试 3：时间切片模拟 ──

console.log("\n【测试 3】时间切片（可中断任务）\n");

let workUnits = 0;
const totalWork = 10;

// 模拟一个大任务，每次执行一个工作单元
function performWork(didTimeout) {
  // 每次执行一个单元
  workUnits++;
  console.log(`  执行工作单元 ${workUnits}/${totalWork}`);

  if (workUnits < totalWork) {
    // 没完成 → 返回自身（continuation）
    return performWork;
  }
  // 完成 → 返回 null
  console.log("  任务完成!");
  return null;
}

// 模拟时间切片执行
deadline = getCurrentTime() + 1000;
push(taskQueue, {
  id: 100,
  callback: performWork,
  priorityLevel: NormalPriority,
  startTime: getCurrentTime(),
  expirationTime: getCurrentTime() + NORMAL_TIMEOUT,
  sortIndex: getCurrentTime() + NORMAL_TIMEOUT,
});

// 手动 workLoop 几轮
currentTask = peek(taskQueue);
while (currentTask && workUnits < totalWork) {
  workLoop(getCurrentTime());
  currentTask = peek(taskQueue);
}

// ── 测试 4：取消任务 ──

console.log("\n【测试 4】取消任务\n");

executionLog.length = 0;
taskIdCounter = 1;

const task1 = scheduleCallback(NormalPriority, () => { executionLog.push("task1"); });
const task2 = scheduleCallback(NormalPriority, () => { executionLog.push("task2"); });
const task3 = scheduleCallback(NormalPriority, () => { executionLog.push("task3"); });

cancelCallback(task2); // 取消 task2

// 同步执行
deadline = getCurrentTime() + 1000;
advanceTimers(getCurrentTime());
while (peek(taskQueue)) {
  const t = peek(taskQueue);
  if (t.callback) {
    t.callback();
    t.callback = null;
  }
  pop(taskQueue);
}
isHostCallbackScheduled = false;

console.log("  调度: task1, task2, task3（取消 task2）");
console.log("  实际执行:", executionLog.join(", ")); // task1, task3

console.log("\n\n=== 面试要点 ===");
console.log("1. Scheduler 解决长任务阻塞主线程问题：时间切片 + 优先级 + 可中断");
console.log("2. 用最小堆管理任务队列（按过期时间排序），O(log n) 插入，O(1) 取最高优先级");
console.log("3. 5 个优先级：Immediate(-1ms) > UserBlocking(250ms) > Normal(5s) > Low(10s) > Idle(永不)");
console.log("4. 时间切片 5ms：每次 workLoop 循环检查 shouldYield()，超时就中断让出主线程");
console.log("5. 用 MessageChannel 而非 setTimeout 做异步调度（延迟更低，约 0-1ms vs 4ms）");
console.log("6. 任务 callback 返回函数 = 未完成（continuation），返回 null = 完成");
console.log("7. 取消任务：不从堆中删除（O(n)），只清空 callback，workLoop 时跳过");
