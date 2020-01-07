/******************************************* */
class PersonClass{
  constructor(){
    this.name = name;
  }
  sayName(){
    console.log(this.name);
  }
}
/*********************通过ES5实现以上代码************* */
let PersonClass = (function(){
  'use strit';
  const PersonClass = function(name){
    if(typeof new.target === 'undefined'){
      throw new Error('必须通过new调用');
    }
    this.name = name;
  }
  Object.defineProperty(PersonClass, "sayName", {
    configurable: true,
    enumerable: false,
    wirtable: true,
    value: function() {
      if(typeof new.target !== 'undefined'){
        throw new Error('不可以使用关键字new调用该方法');
      }
      console.log(this.name);
    }
  });
  return PersonClass;
}())
