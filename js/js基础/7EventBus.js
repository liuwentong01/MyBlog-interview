class EventEmitter {
  constructor() {
    this._events = {};
  }
  on(type, hanlder) {
    this._events[type]
      ? this._events[type].push(hanlder)
      : (this._events[type] = [hanlder]);
  }
  off(type) {
    this._events[type] && delete this._events[type];
  }
  emit(type, ...args) {
    this._events[type] && this._events[type].forEach((cb) => cb(...args));
  }
  once(type, handler) {
    this.on(type, (...args) => {
      handler(...args);
      this.off(type);
    })
  }
}

let emitter = new EventEmitter();
emitter.once("ages", (age) => {
  console.log(age);
});
emitter.emit("ages", 15);
emitter.emit("ages", 16);
emitter.on("focus", (state) => console.log(state));
emitter.emit("focus", "xxx", "yyy");
emitter.emit("focus", "xxx", "yyy");
