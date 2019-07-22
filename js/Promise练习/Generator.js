/**
 * 迭代器：为了解决例如多层for循环嵌套导致必须追踪多个变量（减少程序复杂性）的问题
 * 迭代器是一个特殊对象
 */
//es5创建一个迭代器
function createIterator(items) {
  var i = 0;
  return {
    next: function() {
      var done = i >= items.length;
      var value = !done ? items[i++] : undefined;
      return {
        done: done,
        value: value
      };
    }
  };
}
var iterator = createIterator([1, 2, 3]);
iterator.next();
iterator.next();
iterator.next();

/**
 * 生成器： 生成器是一种返回迭代器的函数
 */
//eg2生成器
function* createIterator() {
  yield 1;
  yield 2;
  yield 3;
}
let iterator = createIterator();
console.log(iterator.next().value);
console.log(iterator.next().value);
console.log(iterator.next().value); //log   1  2  3

//eg3访问默认迭代器 Synbol.iterator
var value = [1, 2, 3];
var iterator = value[Symbol.iterator]();
iterator.next();

//eg4 判断是否有迭代器
function isIterator(obj) {
  return typeof obj[Symbol.iterator] == "function";
}

//eg5 集合对象迭代器  entry()  values()  keys()   主要针对set  map   数组;   WeakSet   WeakMap内部没有迭代器
//var color = ["red", "yellow", "blue"];

//eg6  字符串迭代器

//eg7  NodeList类型也有默认迭代器与数组完全一致

//eg8  展开运算符用于非数组可迭代对象如set, map等会将其转化为数组

//eg9在数组字面量中使用展开运算符

//eg10 给迭代器传值

//eg11 在迭代器中抛出错误

//eg12 生成器返回语句

//eg13 生成器委托

//eg14 生成器异步应用p174

//
var person = {
  getGreeting(){
    return "hello";
  }
}
var dog = {
  getGreeting(){
    return "woof";
  }
}
var  friend = {
  getGreeting(){
    return Object.getPrototypeOf(this).getGreeting.call(this) + ', hi';
  }
}
Object.setPrototypeOf(friend, person);
console.log(friend.getGreeting());