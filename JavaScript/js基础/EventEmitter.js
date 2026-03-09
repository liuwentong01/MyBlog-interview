/**
 * 手写 EventEmitter（事件发射器）
 *
 * Node.js events 模块的核心类，也是浏览器 EventTarget 的简化版。
 * 几乎所有 Node.js 核心模块（Stream、HTTP、Net）都继承自它。
 *
 * 核心思想：发布-订阅模式（Pub/Sub）
 * - 维护一个 { eventName -> [listener1, listener2, ...] } 的映射表
 * - emit 时遍历对应事件的所有 listener 并依次同步调用
 *
 * 本实现覆盖 Node.js EventEmitter 的主要 API：
 *  on / addListener     - 注册监听器
 *  off / removeListener - 移除指定监听器
 *  once                 - 注册只触发一次的监听器
 *  emit                 - 触发事件
 *  removeAllListeners   - 移除某事件（或全部）的所有监听器
 *  listeners            - 获取某事件的监听器副本
 *  listenerCount        - 获取监听器数量
 *  eventNames           - 获取所有已注册事件名
 *  prependListener      - 将监听器插入队列头部
 *  prependOnceListener  - 将只触发一次的监听器插入队列头部
 *  setMaxListeners      - 设置最大监听器数量（防内存泄漏警告）
 */

class EventEmitter {
  constructor() {
    // 核心数据结构：事件名 -> 监听器数组
    // 用 Object.create(null) 创建无原型对象，避免 hasOwnProperty 等原型属性冲突
    this._events = Object.create(null);

    // 最大监听器数量，超过会打印警告（帮助排查内存泄漏）
    // Node.js 默认值也是 10
    this._maxListeners = 10;
  }

  /**
   * on(eventName, listener) - 注册监听器
   *
   * 将 listener 添加到 eventName 对应的监听器数组末尾。
   * 同一个 listener 可以被多次添加（Node.js 原版也是如此）。
   *
   * 返回 this 以支持链式调用：emitter.on('a', fn1).on('b', fn2)
   */
  on(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`listener must be a function, got ${typeof listener}`);
    }

    if (!this._events[eventName]) {
      this._events[eventName] = [];
    }

    this._events[eventName].push(listener);

    // 超过 maxListeners 时打印警告，帮助开发者发现潜在的内存泄漏
    // 比如在循环里反复 on() 但忘了 off()
    if (this._events[eventName].length > this._maxListeners && this._maxListeners > 0) {
      console.warn(
        `[EventEmitter] 警告: "${eventName}" 事件已有 ${this._events[eventName].length} 个监听器，` +
        `超过上限 ${this._maxListeners}。可能存在内存泄漏。\n` +
        `使用 emitter.setMaxListeners(n) 调整上限。`
      );
    }

    return this;
  }

  /** addListener 是 on 的别名（Node.js 兼容） */
  addListener(eventName, listener) {
    return this.on(eventName, listener);
  }

  /**
   * off(eventName, listener) - 移除指定监听器
   *
   * 关键细节：如果同一个 listener 被添加了多次，off 每次只移除一个（从后往前找）。
   * 这与 Node.js 的行为一致。
   *
   * 对于 once 注册的监听器，需要特殊处理——
   * once 内部会用一个包装函数替代原始 listener，
   * 所以 off 时需要比对包装函数上挂载的 .raw 属性。
   */
  off(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`listener must be a function, got ${typeof listener}`);
    }

    const listeners = this._events[eventName];
    if (!listeners) return this;

    // 从后往前找，找到第一个匹配的就移除
    // 匹配条件：直接相等，或者是 once 包装函数且 .raw === listener
    for (let i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i] === listener || listeners[i].raw === listener) {
        listeners.splice(i, 1);
        break; // 每次只移除一个
      }
    }

    // 清理空数组，避免事件名残留
    if (listeners.length === 0) {
      delete this._events[eventName];
    }

    return this;
  }

  /** removeListener 是 off 的别名 */
  removeListener(eventName, listener) {
    return this.off(eventName, listener);
  }

  /**
   * once(eventName, listener) - 注册只触发一次的监听器
   *
   * 实现思路：用一个包装函数 wrapper 代替原始 listener 注册。
   * wrapper 被调用时：先 off 自己，再执行原始 listener。
   * 在 wrapper 上挂 .raw = listener，这样 off(eventName, listener) 也能正确移除。
   */
  once(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`listener must be a function, got ${typeof listener}`);
    }

    const wrapper = (...args) => {
      // 先移除，再执行（保证即使 listener 内部再次 emit 也不会重复触发）
      this.off(eventName, wrapper);
      listener.apply(this, args);
    };

    // 挂载原始引用，让 off(eventName, originalListener) 能匹配到 wrapper
    wrapper.raw = listener;

    return this.on(eventName, wrapper);
  }

  /**
   * emit(eventName, ...args) - 触发事件
   *
   * 关键细节：
   * 1. 遍历前先浅拷贝监听器数组，因为 listener 执行中可能会 on/off 修改原数组
   *    如果不拷贝，可能导致跳过某些 listener 或重复执行
   * 2. 同步依次调用（Node.js EventEmitter 是同步的，不是微任务/宏任务）
   * 3. 返回 boolean：true 表示有监听器被调用，false 表示没有
   */
  emit(eventName, ...args) {
    const listeners = this._events[eventName];
    if (!listeners || listeners.length === 0) {
      return false;
    }

    // 浅拷贝，防止遍历过程中因 once/off 导致数组变化
    const handlers = [...listeners];

    for (const handler of handlers) {
      handler.apply(this, args);
    }

    return true;
  }

  /**
   * removeAllListeners([eventName]) - 移除所有监听器
   *
   * 不传参数：清除所有事件的所有监听器
   * 传 eventName：只清除该事件的监听器
   */
  removeAllListeners(eventName) {
    if (eventName === undefined) {
      this._events = Object.create(null);
    } else {
      delete this._events[eventName];
    }
    return this;
  }

  /**
   * listeners(eventName) - 获取某事件的监听器列表（返回副本）
   *
   * 对于 once 注册的，返回原始 listener（通过 .raw 还原）
   */
  listeners(eventName) {
    const raw = this._events[eventName];
    if (!raw) return [];
    return raw.map(fn => fn.raw || fn);
  }

  /** listenerCount(eventName) - 获取监听器数量 */
  listenerCount(eventName) {
    const listeners = this._events[eventName];
    return listeners ? listeners.length : 0;
  }

  /** eventNames() - 获取所有已注册事件名 */
  eventNames() {
    return Object.keys(this._events);
  }

  /**
   * prependListener(eventName, listener) - 将监听器插入队列头部
   *
   * 普通的 on() 是 push 到末尾（先注册先执行），
   * prepend 是 unshift 到头部（后注册但先执行）。
   */
  prependListener(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`listener must be a function, got ${typeof listener}`);
    }

    if (!this._events[eventName]) {
      this._events[eventName] = [];
    }

    this._events[eventName].unshift(listener);
    return this;
  }

  /** prependOnceListener - once + prepend 的组合 */
  prependOnceListener(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`listener must be a function, got ${typeof listener}`);
    }

    const wrapper = (...args) => {
      this.off(eventName, wrapper);
      listener.apply(this, args);
    };
    wrapper.raw = listener;

    if (!this._events[eventName]) {
      this._events[eventName] = [];
    }

    this._events[eventName].unshift(wrapper);
    return this;
  }

  /**
   * setMaxListeners(n) - 设置最大监听器数量
   *
   * 设为 0 或 Infinity 表示不限制。
   * 这不是硬限制（不会阻止添加），只是超过时打印警告。
   */
  setMaxListeners(n) {
    if (typeof n !== 'number' || n < 0) {
      throw new RangeError(`maxListeners must be a non-negative number, got ${n}`);
    }
    this._maxListeners = n;
    return this;
  }

  getMaxListeners() {
    return this._maxListeners;
  }
}

// ==================== 测试用例 ====================

function assert(condition, msg) {
  if (!condition) throw new Error(`❌ 断言失败: ${msg}`);
  console.log(`  ✅ ${msg}`);
}

console.log('\n===== EventEmitter 测试 =====\n');

// ---------- 1. 基本 on / emit ----------
console.log('1. on + emit 基本事件触发');
{
  const ee = new EventEmitter();
  const results = [];

  ee.on('data', (val) => results.push(val));
  ee.on('data', (val) => results.push(val * 10));

  ee.emit('data', 3);

  assert(results[0] === 3, '第一个监听器收到参数 3');
  assert(results[1] === 30, '第二个监听器收到参数 3，计算为 30');
  assert(ee.emit('data', 1) === true, 'emit 有监听器时返回 true');
  assert(ee.emit('nothing') === false, 'emit 无监听器时返回 false');
}

// ---------- 2. once 只触发一次 ----------
console.log('\n2. once 只触发一次');
{
  const ee = new EventEmitter();
  let count = 0;

  ee.once('ping', () => count++);

  ee.emit('ping');
  ee.emit('ping');
  ee.emit('ping');

  assert(count === 1, `once 监听器只执行了 1 次（实际 ${count} 次）`);
  assert(ee.listenerCount('ping') === 0, 'once 执行后自动移除');
}

// ---------- 3. off 移除指定监听器 ----------
console.log('\n3. off 移除指定监听器');
{
  const ee = new EventEmitter();
  let called = false;
  const fn = () => { called = true; };

  ee.on('test', fn);
  ee.off('test', fn);
  ee.emit('test');

  assert(called === false, 'off 后 listener 不再被调用');
}

// ---------- 4. off 移除 once 注册的监听器 ----------
console.log('\n4. off 能正确移除 once 注册的监听器');
{
  const ee = new EventEmitter();
  let called = false;
  const fn = () => { called = true; };

  ee.once('test', fn);
  ee.off('test', fn); // 通过 .raw 匹配
  ee.emit('test');

  assert(called === false, 'off(原始listener) 能移除 once 包装');
}

// ---------- 5. emit 过程中 off 不影响本轮遍历 ----------
console.log('\n5. emit 遍历安全（listener 中 off 不影响本轮）');
{
  const ee = new EventEmitter();
  const order = [];

  const fn1 = () => {
    order.push('fn1');
    ee.off('evt', fn2); // 在 fn1 执行时移除 fn2
  };
  const fn2 = () => order.push('fn2');
  const fn3 = () => order.push('fn3');

  ee.on('evt', fn1);
  ee.on('evt', fn2);
  ee.on('evt', fn3);

  ee.emit('evt');

  // 因为 emit 前做了浅拷贝，fn2 在本轮仍然会执行
  assert(order.join(',') === 'fn1,fn2,fn3', `本轮三个都执行: ${order.join(',')}`);

  // 第二次 emit，fn2 已被移除
  order.length = 0;
  ee.emit('evt');
  assert(order.join(',') === 'fn1,fn3', `第二次只剩 fn1,fn3: ${order.join(',')}`);
}

// ---------- 6. prependListener ----------
console.log('\n6. prependListener 插入队列头部');
{
  const ee = new EventEmitter();
  const order = [];

  ee.on('evt', () => order.push('A'));
  ee.prependListener('evt', () => order.push('B'));

  ee.emit('evt');
  assert(order.join(',') === 'B,A', `prepend 的 B 先执行: ${order.join(',')}`);
}

// ---------- 7. removeAllListeners ----------
console.log('\n7. removeAllListeners');
{
  const ee = new EventEmitter();
  ee.on('a', () => {});
  ee.on('b', () => {});
  ee.on('b', () => {});

  ee.removeAllListeners('b');
  assert(ee.listenerCount('a') === 1, '只移除了 b，a 还在');
  assert(ee.listenerCount('b') === 0, 'b 的监听器全部移除');

  ee.removeAllListeners();
  assert(ee.eventNames().length === 0, '无参数时清除全部');
}

// ---------- 8. listeners 返回原始引用 ----------
console.log('\n8. listeners() 返回原始 listener（还原 once 包装）');
{
  const ee = new EventEmitter();
  const fn = () => {};

  ee.once('evt', fn);
  const list = ee.listeners('evt');

  assert(list[0] === fn, 'once 注册的也能拿到原始函数引用');
}

// ---------- 9. 链式调用 ----------
console.log('\n9. 链式调用');
{
  const ee = new EventEmitter();
  const result = ee.on('a', () => {}).on('b', () => {}).once('c', () => {});
  assert(result === ee, 'on/once 返回 this，支持链式调用');
}

// ---------- 10. 多参数传递 ----------
console.log('\n10. 多参数传递');
{
  const ee = new EventEmitter();
  let received;

  ee.on('multi', (a, b, c) => { received = [a, b, c]; });
  ee.emit('multi', 'x', 42, true);

  assert(received.join(',') === 'x,42,true', `收到多个参数: ${received.join(',')}`);
}

console.log('\n===== 全部测试通过 =====\n');
