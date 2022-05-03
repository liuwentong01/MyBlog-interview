/**1.ES5实现一个迭代器 */
function createIterator(items){
  var i = 0;
  return {
    next : function(){
      var done = (done >= items.length);
      var value = !done ? items[i++] : undefined;
      return{
        value: value,
        done: done,
      }
    }
  }
}

var iterator = createIterator([2,4,6]);
console.log(iterator.next());
console.log(iterator.next());
console.log(iterator.next());
console.log(iterator.next());


 // 2.判断对象是不是可迭代对象(通过Symbol.iterator可以访问到对象的默认迭代器)
function isIterator(obj){
  return typeof obj[Symbol.iterator] == 'function';
}
console.log(isIterator([1,2,3]));
console.log(isIterator('hello'));
console.log(isIterator(new Map));
console.log(isIterator(new Object()));

//3.创建可迭代对象
var collection = {
  items: [],
  [Symbol.iterator]: function*(){
    for(var i of this.items){
      yield i;
    }
  }
}
collection.items.push(1);
collection.items.push(2);
collection.items.push(3);
for(var i of collection){
  console.log(i);
}

//4.展开运算符
/** 
 * 展开运算符可以作用于所有可迭代对象
 * eg1: var set = new Set([1,2,3,6,5,4]);
 * var arr = [...set];
 * eg2: var map = new Map([['name', 'zhangsan'], ['age', 25]])
 * var arr = [...map];
 * 
 * eg3: var arr1 = [1,2,3];
 *      var arr2 = [4,5,6];
 *      var arr = [0, ...arr1, ...arr2]
 * */
 
 //5.异步任务执行器
//eg1
function run(taskDef){
  var task = taskDef();
  var result = task.next();
  function step(){
    if(!result.done){
      result = result.next(result.value);
      step();
    }
  }
  step();
}

