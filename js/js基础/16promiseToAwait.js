//每一个async函数都会返回一个promise
async function sayName(){
  console.log('lwt');
}

function sayName(){
  console.log('lwt');
  Promise.resolve();
}

// await后面会返回一个promise
async function async1() {
  console.log("async1 start");
  await async2();
  console.log("async1 end");
}

function async1(){
  console.log('async1 start');
  return new Promise(resolve => resolve(async2())).then(() => console.log('async1 end'))
}

