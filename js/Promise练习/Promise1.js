/*************摘自深入理解ES6中Promise的大量实例************************************ */
//javascript引擎是基于单线程事件循环构建的
//一个对象有then方法那么它就是thenable对象，所有promise都是thenable对象，但是并非所有thenable对象都是Promise


/*eg1：*************************************************************************************/
let promise = readFile("example.txt");
promise.then(function(value){
  //完成
  console.log(value);
}, function(err){
  console.log(err);
})

promise.catch(function(err){
  console.log(err);           //与then只传递第二个参数等价
})
/*eg2  new Promise()***************************************************************************************** */
let fs = require("fs");
let promise = readFile("example.txt");

function readFile(filename){
  return new Promise(function(resolve, reject){
    fs.readFile(filename, {encoding: utf-8}, function(err, contents){
      if(err){
        reject(err);
        return;
      }
      resolve(contents);
    })
  })
}
promise.then(function(contents){
  console.log(contents);
}, function(err){
  console.error(err.message);
})
/*eg3 Promise任务队列*************************************************************************************************** */
//Promise执行器会立即执行
setTimeout(function(){
  console.log("abc");
}, 0);
let promise = new Promise(function(resolve, reject){
  console.log("111");
  resolve();
})
promise.then(function(){
  console.log("222");
})
console.log("333");
//print   111    333    222   <---  abc
//完成处理程序和拒绝处理程序添加到任务队列的末尾，setTimeout是添加到下一轮任务队列开头吧。。。
/*eg4 Promise.resolve() Promise.reject()************************************************************* */
let promise = Promise.resolve(42);
promise.then(function(value){
  console.log(value); //42
})
let promise = Promise.reject(42);
promise.then(function(value){
  console.log(value);  //42
})
/*非Promise的Thenable对象********************************************************* */
//Promise.resolve()和Promise.reject()方法都可以接受非Promise的Thenable对象作为参数  并返回一个Promise再then函数与中调用
//Thenable对象： 拥有then方法，并且接受resolve和reject这两个参数的普通对象就是Thenable对象。例如
let thenable = {
  then: function(resolve, reject){
    resolve(42)
  }
}
let p1 = Promise.resolve(thenable).then(function(value){
  console.log(value);
})
//通过Promise.resolve()方法将thenable对象转化为已完成的Promise
/*Promise.catch()***************************************************************************************** */
let promise = new Promise(function(resolve, reject){
  throw new Error('you are wrong');
})
promise.catch(function(err){
  console.log(err.message);//err.message取到 ‘you are wrong’
})
//因为每个执行器内都存在一个try...catch块所以有错误时捕获并且传入拒绝处理程序中，所以此例等价于下面的例子
let promise =new Promise(function(resolve, reject){
  try{
    throw new Error("you are wrong");
  } catch(ex){
    reject(ex);
  }
})
promise.catch(function(err){
  console.log(err.message);
});








