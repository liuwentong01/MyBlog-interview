/**观察者模式
 * 就是在数据发生改变时，对应的处理函数自动执行。
 * 那么如果不进行主动通知，而是在进行对象属性值设置时，调用相关的处理函数，也可达到同等效果。
*/
/**ES5实现观察者模式 */
var targetObj = {
  age: 1
};
function observer(oldVal, newVal) {
  // 其他处理逻辑...
  console.info("name属性的值从 " + oldVal + " 改变为 " + newVal);
}

Object.defineProperty(targetObj, "name", {
  enumerable: true,
  configurable: true,
  get: function() {
    return name;
  },
  set: function(val) {
    //调用处理函数
    observer(name, val);
    name = val;
  }
});

targetObj.name = "liu";
targetObj.name = "feng";


/**ES6实现观察者模式
 */
class TargetObj {
    constructor(age, name) {
        this.name = name;
        this.age = age;
    }
    set name(val) {
        observer(name, val);
        name = val;
    }
}

let targetObj = new TargetObj(1, 'Martin');
function observer(oldVal, newVal) {
	// 其他处理逻辑...
    console.info('name属性的值从 '+ oldVal +' 改变为 ' + newVal);
}
targetObj.name = 'Lucas';
console.info(targetObj)
