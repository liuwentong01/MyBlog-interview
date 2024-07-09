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
<<<<<<< HEAD
  once(type, hanlder) {
    this.on(type, (...args) => {
      hanlder(...args);
      this.off(type);
    });
=======
  once(type, handler) {
    this.on(type, (...args) => {
      handler(...args);
      this.off(type);
    })
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
  }
}

let emitter = new EventEmitter();
emitter.once("ages", (age) => {
  console.log(age);
});
<<<<<<< HEAD
emitter.emit("ages", 12)
emitter.emit("ages", 13)
// emitter.on("focu", (state) => console.log(state));
// emitter.emit("focu", "xxx", "yyy");
=======
emitter.emit("ages", 15);
emitter.emit("ages", 16);
emitter.on("focus", (state) => console.log(state));
emitter.emit("focus", "xxx", "yyy");
emitter.emit("focus", "xxx", "yyy");
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
