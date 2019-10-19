function createAnother(original) {
  var clone = object(original); //通过调用object函数创建一个新对象
  clone.sayHi = function() {
    //以某种方式来增强这个对象
    alert("hi");
  };
  return clone; //返回这个对象
}


