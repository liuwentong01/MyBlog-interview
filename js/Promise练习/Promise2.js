import { resolve } from "./Promise3";

/**********************************Promise练习(掘金)********************************* */
//(源文链接)https://juejin.im/post/5a04066351882517c416715d

/*必会10题(环境均为nodejs)**************************************************************************************** */
//eg1
const promise = new Promise(function(resolve, reject){
  console.log(1);
  resolve();
  console.log(2);
})
promise.then(function(){
  console.log(3);
})
console.log(4);
//log   1   2   4   3

//eg2
const promise1 = new Promise(function(resolve, reject){
  setTimeout(function(){
    resolve('success')
  }, 1000);
})
promise2 = promise1.then(function(value){
  throw new Error("wrong");
})
console.log('promise1', promise1);
console.log('promise2', promise2);
setTimeout(function(){
  console.log("promise1", promise1);
  console.log("promise2", promise2);
}, 2000);

//eg3
const promise = new Promise(function(resolve, reject){
  resolve('success');
  reject('failed');
  resolve('success2');
})
promise.then(function(mess){
  console.log(mess);
})
//此例说明了promise状态一旦改变则不能再变

//eg4
const promise = Promise.resolve(1)
.then(function(mess){
  console.log(mess);
  resolve(6);  //resolve()前不能return；否则无限pending,    可以用Promise.resolve();
  return 2;
})
.catch(function(mess){
  console.log(mess);    // log  resolve()is not defined
  return 3;              
})
.then(function(mess){
  console.log(mess);  // log 3
})

//eg5
const promise = new Promise(function(resolve, reject){
  setTimeout(function(){
    console.log('once');
    resolve('success');
  }, 1000);
})
var start= Date.now();
promise.then(function(res){
  console.log(res, Date.now() - start);
})
promise.then(function(res) {
  console.log(res, Date.now() - start);
});

//eg6
Promise.resolve()
.then(function(){
  return new Error("111"); //then 或者 catch中return一个ERROR对象不会被后续的catch捕获
})
.then(function(res){
  console.log(res);
 // return 'then has excuted';
})
.catch(function(err){
  console.log(err);
});

//eg7
const promise = Promise.resolve();  //可以, 加不加冒号的区别。。。
promise.then(function(){
  return promise;
})
promise.catch(function(err){
  console.log(err);
});

const promise = Promise.resolve() //不可以，死循环
  .then(function() {
    return promise;
  })
  promise.catch(function(err) {
    console.log(err);
  });

//eg9
Promise.resolve()
  .then(
    function success1(res) {
      throw new Error("error");
    },
    function fail1(e) {
      console.error("fail1: ", e);
    }
  )
  .then(
    function success2(res) {},
    function fail2(e) {
      console.error("fail2: ", e);
    }
  );
  //重点

//eg10













