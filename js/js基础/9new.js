/*****************************new的实现************************************************/
function new0(func, ...args) {
  var obj = new Object();
  obj.__proto__ = func.prototype;
  var result = func.apply(obj, args);
  return typeof result == "object" ? result : obj;
}
/**练习 */

function Person(name, value) {
  this.name = name;
  this.value = value;
}
