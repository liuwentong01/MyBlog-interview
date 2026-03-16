/*****************************new的实现************************************************/

// ===================== 写法一：Object.create（经典写法） =====================
// 步骤：创建对象 → 绑定原型 → 执行构造函数 → 判断返回值
function myNew1(Constructor, ...args) {
  // Object.create 一步到位：创建空对象并将其 __proto__ 指向 Constructor.prototype
  // 这三行等价
  // const obj = Object.create(Constructor.prototype);   // 推荐，创建时直接指定
  // Object.setPrototypeOf(obj, Constructor.prototype);   // 创建后再设置，规范方法
  // obj.__proto__ = Constructor.prototype;                // 创建后再设置，非规范但广泛支持
  const obj = Object.create(Constructor.prototype);
  const result = Constructor.apply(obj, args);
  // 构造函数返回对象或函数时使用该返回值，否则使用新创建的对象
  // 注意：必须同时判断 "object" 和 "function"，因为 typeof function === "function"
  return result !== null && (typeof result === "object" || typeof result === "function")
    ? result
    : obj;
}


// ===================== 写法二：手动设置 __proto__（更底层） =====================
// 不用 Object.create，手动拆解原型链的建立过程，帮助理解 Object.create 做了什么
function myNew2(Constructor, ...args) {
  const obj = {};
  // 等价于 Object.create(Constructor.prototype)，但更直观地展示原型链的连接
  // 注意：__proto__ 虽被广泛支持，但不推荐在生产中使用，此处仅为教学
  Object.setPrototypeOf(obj, Constructor.prototype);
  const result = Constructor.apply(obj, args);
  return result !== null && (typeof result === "object" || typeof result === "function")
    ? result
    : obj;
}


// TODO ===================== 写法三：Reflect.construct（ES6+ 推荐） =====================
// Reflect.construct 是语言层面对 new 操作的抽象，一行搞定
// 内部自动完成：创建对象、绑定原型、执行构造函数、处理返回值
// 第三个参数 newTarget 可以指定 new.target，在继承场景下非常有用
function myNew3(Constructor, ...args) {
  return Reflect.construct(Constructor, args);
}


// ===================== 写法四：支持 new.target 的完整版 =====================
// new.target 是 ES6 引入的元属性，在构造函数中可以检测是否通过 new 调用
// 写法一/二中 Constructor 内部的 new.target 是 undefined（因为是 apply 调用）
// 这个版本通过 Reflect.construct 的第三个参数正确设置 new.target
function myNew4(Constructor, ...args) {
  // 第三个参数指定 new.target 的值，确保构造函数内部能正确获取
  // 常见用途：抽象类通过 new.target 防止直接实例化
  return Reflect.construct(Constructor, args, Constructor);
}


// ===================== 测试 =====================
function Person(name, value) {
  this.name = name;
  this.value = value;
}
Person.prototype.sayName = function () {
  return this.name;
};

// 基本功能测试
console.log("--- 写法一：Object.create ---");
var p1 = myNew1(Person, "Tom", 100);
console.log(p1.name, p1.value, p1.sayName(), p1 instanceof Person);
// Tom 100 Tom true

console.log("--- 写法二：setPrototypeOf ---");
var p2 = myNew2(Person, "Jerry", 200);
console.log(p2.name, p2.value, p2.sayName(), p2 instanceof Person);
// Jerry 200 Jerry true

console.log("--- 写法三：Reflect.construct ---");
var p3 = myNew3(Person, "Alice", 300);
console.log(p3.name, p3.value, p3.sayName(), p3 instanceof Person);
// Alice 300 Alice true

console.log("--- 写法四：支持 new.target ---");
var p4 = myNew4(Person, "Bob", 400);
console.log(p4.name, p4.value, p4.sayName(), p4 instanceof Person);
// Bob 400 Bob true

// 构造函数返回对象的边界测试
function Weird() {
  return { custom: true };
}
console.log("\n--- 构造函数返回对象 ---");
console.log(myNew1(Weird));  // { custom: true }
console.log(myNew2(Weird));  // { custom: true }

// 构造函数返回函数的边界测试
function ReturnsFunc() {
  return function hello() {};
}
console.log("\n--- 构造函数返回函数 ---");
console.log(typeof myNew1(ReturnsFunc)); // function
console.log(typeof myNew2(ReturnsFunc)); // function
