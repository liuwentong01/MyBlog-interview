
// ===================== 写法一：ES6+ 箭头函数简化版 =====================
// 改进点：
//   1. 箭头函数自动绑定 this，不再需要 var that = this
//   2. 箭头函数 + 块级作用域，参数天然被闭包捕获，不再需要 IIFE
//   3. 可选链 ?.() 替代 fn && fn()
class LazyManV1 {
  taskList = [];

  constructor(name) {
    console.log(`Hi I am ${name}`);
    // setTimeout(0) 将 next() 推入宏任务队列
    // 确保所有链式调用（同步代码）注册完毕后，才开始执行第一个任务
    setTimeout(() => this.next(), 0);
  }

  eat(food) {
    this.taskList.push(() => {
      console.log(`I am eating ${food}`);
      this.next(); // 同步任务执行完后，手动触发下一个
    });
    return this; // 返回 this 支持链式调用
  }

  sleep(time) {
    this.taskList.push(() =>
      setTimeout(() => {
        console.log(`等待了${time}秒...`);
        this.next(); // 异步等待结束后，手动触发下一个
      }, time * 1000)
    );
    return this;
  }

  // sleepFirst 插入队头，优先执行
  sleepFirst(time) {
    this.taskList.unshift(() =>
      setTimeout(() => {
        console.log(`等待了${time}秒...`);
        this.next();
      }, time * 1000)
    );
    return this;
  }

  next() {
    // 从队头取出一个任务并执行，队列为空时自动停止
    this.taskList.shift()?.();
  }
}

// new LazyManV1("Tony").eat("lunch").eat("dinner").sleepFirst(5).sleep(4).eat("junk food");

// Hi I am Tony
// 等待了5秒...
// I am eating lunch
// I am eating dinner
// 等待了4秒...
// I am eating junk food

// ===================== 写法二：Promise 链式版 =====================
// 核心思路：用 Promise 链替代任务数组 + 手动 next()
//   - 每次调用 eat/sleep 就是在 promise 链尾部追加 .then()
//   - 同步任务直接在 .then() 中执行
//   - 异步任务返回一个新的 Promise，链会自动等待它 resolve 后再继续
//   - sleepFirst 需要把新 Promise 拼接到链头部
// 优点：完全不需要任务数组和 next()，Promise 微任务机制自动串行
// 注意：Promise.resolve().then() 本身是微任务，会在当前同步代码之后执行，
//       所以不需要 setTimeout(0) 来延迟启动
class LazyManV2 {
  promise = Promise.resolve();

  constructor(name) {
    // 这里的 console.log 是同步的，链式调用中最先输出
    console.log(`Hi I am ${name}`);
  }

  eat(food) {
    // 在链尾追加一个同步任务
    this.promise = this.promise.then(() => console.log(`I am eating ${food}`));
    return this;
  }

  sleep(time) {
    // 在链尾追加一个异步任务，返回 Promise 让链等待
    this.promise = this.promise.then(
      () => new Promise(resolve =>
        setTimeout(() => {
          console.log(`等待了${time}秒...`);
          resolve();
        }, time * 1000)
      )
    );
    return this;
  }

  // sleepFirst 的关键：把等待任务插到整条链的最前面
  // 做法是创建一个新的 head Promise，等它完成后再接上原来的链
  sleepFirst(time) {
    const oldPromise = this.promise;
    this.promise = new Promise(resolve =>
      setTimeout(() => {
        console.log(`等待了${time}秒...`);
        resolve();
      }, time * 1000)
    ).then(() => oldPromise); // head 完成后，继续执行原有的链
    return this;
  }
}

// new LazyManV2("Tony").eat("lunch").eat("dinner").sleepFirst(5).sleep(4).eat("junk food");


// ===================== 写法三：Async/Await 版（推荐） =====================
// 核心思路：任务只负责定义"做什么"（返回值或 Promise），执行引擎负责"怎么跑"
//   - 同步任务：函数直接执行，返回 undefined
//   - 异步任务：函数返回 Promise，run() 中 await 等待完成
//   - for...of + await 天然串行，不需要手动 next()
// 优点：
//   1. 任务定义与执行逻辑完全解耦
//   2. 最少的代码量，最高的可读性
//   3. 容易扩展（比如加 cancel、pause 等）
class LazyManV3 {
  taskList = [];

  constructor(name) {
    console.log(`Hi I am ${name}`);
    // setTimeout(0) 等所有链式调用注册完毕后再启动
    setTimeout(() => this.run(), 0);
  }

  // 执行引擎：顺序消费任务队列，await 自动处理同步/异步任务
  async run() {
    for (const task of this.taskList) {
      await task();
    }
  }

  eat(food) {
    // 同步任务，不需要返回 Promise
    this.taskList.push(() => console.log(`I am eating ${food}`));
    return this;
  }

  sleep(time) {
    // 异步任务，返回 Promise，run() 中的 await 会等待它完成
    this.taskList.push(
      () => new Promise(resolve =>
        setTimeout(() => {
          console.log(`等待了${time}秒...`);
          resolve();
        }, time * 1000)
      )
    );
    return this;
  }

  // sleepFirst 同样是异步任务，但用 unshift 插到队头
  sleepFirst(time) {
    this.taskList.unshift(
      () => new Promise(resolve =>
        setTimeout(() => {
          console.log(`等待了${time}秒...`);
          resolve();
        }, time * 1000)
      )
    );
    return this;
  }
}

 new LazyManV3("Tony3").eat("lunch").eat("dinner").sleepFirst(5).sleep(4).eat("junk food");


// ===================== 测试 =====================
// 取消注释任意一行来测试对应版本，预期输出：
//   Hi I am Tony
//   等待了5秒...    （sleepFirst 优先执行）
//   I am eating lunch
//   I am eating dinner
//   等待了4秒...
//   I am eating junk food
