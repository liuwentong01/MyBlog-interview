/**
 * 数组扁平化， 方法一：递归 方法二：flat（）
 */
<<<<<<< HEAD
var arr0 = [[222, [333, 236], 444], [55, 66, 77], 7];
=======
var arr = [[222, [333, 236], 444], [55, 66, 77], 7];
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
var res = [];
function toArr(arr) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] instanceof Array) {
      toArr(arr[i]);
    } else {
      res.push(arr[i]);
    }
  }
}
<<<<<<< HEAD
toArr(arr0);
=======
toArr(arr);
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
console.log(res);

//方法二
var arr = [[1, 2], 3];
console.log(arr.flat(Infinity)); //....vscode不支持但是google浏览器是支持的

//方法三
var arr = [
  [0, 1],
  [2, 3],
  [4, [5, 6, 7]]
];
function arrFlat(arr) {
  return arr.reduce(
    (pre, cur) => pre.concat(Array.isArray(cur) ? arrFlat(cur) : cur),
    []
  );
}
arrFlat(arr);
<<<<<<< HEAD

=======
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
