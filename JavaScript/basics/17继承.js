// 1. 原型链继承
// 缺点：引用类型属性被所有实例共享；无法向父构造函数传参
function Animal1() {
  this.colors = ["black", "white"];
}
Animal1.prototype.getColors = function () {
  return this.colors;
};

function Dog1() {}
Dog1.prototype = new Animal1();
Dog1.prototype.constructor = Dog1;

var d1a = new Dog1();
var d1b = new Dog1();
d1a.colors.push("brown");
console.log(d1b.colors); // ['black','white','brown'] —— 共享了引用属性


// 2. 组合继承（经典继承）
// 缺点：父构造函数被调用两次（new Animal2 + Animal2.call）
function Animal2(name) {
  this.name = name;
  this.colors = ["black", "white"];
}
Animal2.prototype.getName = function () {
  return this.name;
};

function Dog2(name, age) {
  Animal2.call(this, name); // 第二次调用父构造函数
  this.age = age;
}
Dog2.prototype = new Animal2(); // 第一次调用父构造函数
Dog2.prototype.constructor = Dog2;

var d2 = new Dog2("旺财", 3);
console.log(d2.getName(), d2.age); // '旺财' 3


// 3. 原型式继承
// 本质：对传入对象的浅拷贝，等同于 Object.create
function objectCreate(o) {
  function F() {}
  F.prototype = o;
  return new F();
}

var person = { name: "Tom", hobbies: ["reading"] };
var p1 = objectCreate(person);
var p2 = objectCreate(person);
p1.hobbies.push("coding");
console.log(p2.hobbies); // ['reading','coding'] —— 同样会共享引用属性


// 4. 寄生式继承
// 在原型式继承基础上增强对象，缺点：方法无法复用
function createAnother(original) {
  var clone = objectCreate(original);
  clone.sayHi = function () {
    console.log("hi");
  };
  return clone;
}

var p3 = createAnother(person);
p3.sayHi(); // 'hi'


// 5. 寄生组合式继承（最优方案）
// 只调用一次父构造函数，原型链保持不变
function inheritPrototype(Child, Parent) {
  var prototype = Object.create(Parent.prototype);
  prototype.constructor = Child;
  Child.prototype = prototype;
}

function Animal5(name) {
  this.name = name;
  this.colors = ["black", "white"];
}
Animal5.prototype.getName = function () {
  return this.name;
};

function Dog5(name, age) {
  Animal5.call(this, name);
  this.age = age;
}
inheritPrototype(Dog5, Animal5);

Dog5.prototype.getAge = function () {
  return this.age;
};

var d5 = new Dog5("小黑", 2);
console.log(d5.getName(), d5.getAge()); // '小黑' 2
console.log(d5 instanceof Animal5); // true


// 6. ES6 class 继承
// 语法糖，底层仍基于寄生组合继承
class Animal6 {
  constructor(name) {
    this.name = name;
    this.colors = ["black", "white"];
  }
  getName() {
    return this.name;
  }
}

class Dog6 extends Animal6 {
  constructor(name, age) {
    super(name);
    this.age = age;
  }
  getAge() {
    return this.age;
  }
}

var d6 = new Dog6("大黄", 4);
console.log(d6.getName(), d6.getAge()); // '大黄' 4
console.log(d6 instanceof Animal6); // true
