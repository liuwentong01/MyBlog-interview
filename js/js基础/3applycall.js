/******************************************call的实现******************************************/
Function.prototype.call0 = function(context, ...arr) {
  context = context || window;
  context.func = this;
  if (!arr.length) {
    var res = context.func();
  } else {
    var res = context.func(...arr);
  }
  delete context.func;
  return res;
};

var v = {
  name: 1
}
function sayName(name, age){
  return{
    name:name,
    age:age,
    value: this.value,
  }
}
sayName.call0(v, 'zhangsan', 33);

/*** ****************************apply的实现********************************************************/
Function.prototype.apply0 = function(context, arr) {
  context = context || window;
  context.func = this;
  if (!arr) {
    var res = context.func();
  } else {
    var res = context.func(arr);
  }
  delete context.func;
  return res;
};
var v = {
  value: 'haha',
}
function sayValue(){
  console.log(this.value);
}
sayValue.apply0(v);

/**简易写法 */



