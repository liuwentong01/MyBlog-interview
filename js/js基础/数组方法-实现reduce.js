Array.prototype.selfReduce = function(fn, initialValue) {
  let arr = this;
  let res;
  let startIndex;
  if (initialValue === undefined) {
    startIndex = 0;
    res = arr[0];
  } else {
    res = initialValue;
  }
  for (let i = ++startIndex || 0; i < arr.length; i++) {
    res = fn.call(null, res, arr[i], i, this);
  }
  return res;
};

Array.prototype.selfReduce ||
  Object.defineProperty(Array.prototype, "selfReduce", {
    value: selfReduce,
    enumerable: false,
    configurable: true,
    writable: true
  });

let arr = [1, 2, 3, 4, 5];

console.log(arr.selfReduce((acc, cur) => acc + cur));
console.log(arr.reduce((acc, cur) => acc + cur));
