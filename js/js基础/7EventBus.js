class EventEmitter{
  constructor(){
    this._events = {};
  }
  on(type, hanlder){
    this._events[type] ? this._events[type].push(hanlder) : this._events[type] = [hanlder];
  }
  off(type){
    this._events[type] && delete this._events[type];
  }
  emit(type, ...args){
    this._events[type] && this._events[type].forEach(cb => cb(...args));
  }
  once(type, hanlder){
    this.on(type, (...args) => {
      hanlder(...args);
      this.off(type);
    })
  }
}

let emitter = new EventEmitter();
// emitter.once("ages", age => {
//   console.log(age);
// });
// emitter.emit('ages', 15)
// emitter.on('focu', (state) => console.log(state));
// emitter.emit('focu', 'xxx', 'yyy')