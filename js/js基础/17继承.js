//组合继承

//原型继承
function Func(o){
  var F = function(){};
  F.prototype = o;
  return new F();
}

//寄生继承
function createAnother(original) {
  var clone = object(original); //通过调用object函数创建一个新对象
  clone.sayHi = function() {
    //以某种方式来增强这个对象
    alert("hi");
  };
  return clone; //返回这个对象
}


//寄生组合继承

