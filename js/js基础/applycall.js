/******************************************call的实现******************************************/
Function.prototype.call2 = function(self){
  self = self || window;
  self.fn = this;
  var args = [];
  for(let i=1; i<arguments.length; i++){
    args.push(arguments[i]);
   // args.push("arguments[" + i + "]"); //@方式二
  }
  //eval('self.fn('+ args +')');@方式二  不用...运算符，用eval实现，更像是call方法因为参数一个个传入。
  var result = self.fn(...args);
  delete self.fn;
  return result;
}

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
sayName.call2(v, 'zhangsan', 33);

/*** ****************************apply的实现********************************************************/
Function.prototype.apply2 = function(self, arr){
  self = self || window;
  self.fn = this;
  var result;
  if(!arr){
    result = self.fn();
  } else{
    result = self.fn(...arr);
  }
  delete self.fn;
  return result;
}
var v = {
  value: 'haha',
}
function sayValue(){
  console.log(this.value);
}
sayValue.apply2(v);

