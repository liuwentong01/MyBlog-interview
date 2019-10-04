/**
 * 数组降维， 方法一：递归 方法二：flat（）
 */
var arr = [[222, [333, 236], 444], [55, 66, 77], 7];
var res = [];
function toArr(arr) {
  for(let i = 0; i < arr.length; i++){
    if (arr[i] instanceof Array) {
      toArr(arr[i]);
    }
    else {
      res.push(arr[i]);
    }
  }
}
toArr(arr);
console.log(res);

//方法二
var arr = [[1, 2], 3];
console.log(arr.flat(Infinity)); //无奈，vscode不支持但是google浏览器是支持的

