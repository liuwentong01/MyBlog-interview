
const add = (a, b, c, d, e) => {
  console.log(a + b + c + d + e);
}

// 方法一
function curry(fn, arr) {
  const len = fn.length;
  arr = arr || [];
  return function () {
    arr = arr.concat([...arguments]);
    if(arr.length < len) {
      return curry(fn, arr);
    } else {
      fn(...arr);
    }
  }
}

const a = curry(add);
a(1)(2,3)(4)(5)

// 方法二
function curry2(fn) {
  let judge = (...args) => {
      if (args.length == fn.length) return fn(...args)
      return (...arg) => judge(...args, ...arg)
  }
  return judge
}

const b = curry2(add);
b(1)(2,3,4)(6)

// ==========================================================================
// 偏函数

function partial(fn, ...args) {
  return (...arg) => {
    return fn(...args, ...arg);
  }
}
// 偏函数就是将一个 n 参的函数转换成固定 x 参的函数，剩余参数（n - x）将在下次调用全部传入。举个例子：
function addd(a, b, c) {
  return a + b + c
}
let partialAdd = partial(addd, 1)
console.log(partialAdd(2, 3))

