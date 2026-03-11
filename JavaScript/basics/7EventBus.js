class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(type, handler) {
    if (!this._events[type]) {
      this._events[type] = [];
    }
    this._events[type].push(handler);
    return this;
  }

  off(type, handler) {
    if (!this._events[type]) return this;
    if (!handler) {
      // 不传 handler 则移除该事件所有监听
      delete this._events[type];
    } else {
      this._events[type] = this._events[type].filter((fn) => fn !== handler);
    }
    return this;
  }

  emit(type, ...args) {
    if (this._events[type]) {
      this._events[type].forEach((cb) => cb(...args));
    }
    return this;
  }

  once(type, handler) {
    const wrapper = (...args) => {
      handler(...args);
      this.off(type, wrapper);
    };
    this.on(type, wrapper);
    return this;
  }
}

// 测试
let emitter = new EventEmitter();

// once 只触发一次
emitter.once("ages", (age) => console.log("once:", age));
emitter.emit("ages", 12); // once: 12
emitter.emit("ages", 13); // 不输出

// on 可多次触发
emitter.on("focus", (state) => console.log("focus:", state));
emitter.emit("focus", "xxx"); // focus: xxx
emitter.emit("focus", "yyy"); // focus: yyy
