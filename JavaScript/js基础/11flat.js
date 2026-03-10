/**
 * 数组扁平化
 */
var arr = [[222, [333, 236], 444], [55, 66, 77], 7];

// 方法一：递归
function flatByRecursion(arr) {
  var res = [];
  for (let i = 0; i < arr.length; i++) {
    if (Array.isArray(arr[i])) {
      res = res.concat(flatByRecursion(arr[i]));
    } else {
      res.push(arr[i]);
    }
  }
  return res;
}
console.log(flatByRecursion(arr));

// 方法二：Array.prototype.flat
console.log(arr.flat(Infinity));

// 方法三：reduce
function flatByReduce(arr) {
  return arr.reduce(
    (pre, cur) => pre.concat(Array.isArray(cur) ? flatByReduce(cur) : cur),
    []
  );
}
console.log(flatByReduce(arr));

// 方法四：展开运算符（迭代式）
function flatBySpread(arr) {
  while (arr.some(Array.isArray)) {
    arr = [].concat(...arr);
  }
  return arr;
}
console.log(flatBySpread(arr));
