/*****************************new的实现************************************************/
<<<<<<< HEAD
function new0(func, ...args) {
  var obj = new Object();
  obj.__proto__ = func.prototype;
  var result = func.apply(obj, args);
  return typeof result == "object" ? result : obj;
}
/**练习 */

=======
function new0() {
  var obj = new Object();
  var con = Array.prototype.shift.call(arguments);
  obj.__proto__ = con.prototype;
  var result = con.apply(obj, arguments);
  return typeof result == "object" ? result : obj;
}

/**练习 */

function new0(context) {
  var obj = new Object();
  var args = Array.prototype.slice.call(arguments, 1);
  obj.__proto__ = context.prototype;
  var result = context.apply(obj, args);
  return typeof result == "object" ? result : obj;
}
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
function Person(name, value) {
  this.name = name;
  this.value = value;
}
<<<<<<< HEAD
=======
new0(Person, "111", "222");

function new1(context, ...args) {
  var obj = new Object();
  obj.__proto__ = context.prototype;
  var result = context.apply(obj, args);
  return typeof result === "object" ? result : obj;
}
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
