/*****************************new的实现************************************************/
function myNew(Constructor, ...args) {
  // 1. 创建空对象，原型指向构造函数的 prototype
  const obj = Object.create(Constructor.prototype);
  // 2. 执行构造函数，绑定 this
  const result = Constructor.apply(obj, args);
  // 3. 如果构造函数返回了对象则用它，否则返回新创建的对象
  return result !== null && typeof result === "object" ? result : obj;
}

// 测试
function Person(name, value) {
  this.name = name;
  this.value = value;
}
Person.prototype.sayName = function () {
  return this.name;
};

var p = myNew(Person, "Tom", 100);
console.log(p.name);      // 'Tom'
console.log(p.value);     // 100
console.log(p.sayName()); // 'Tom'
console.log(p instanceof Person); // true
