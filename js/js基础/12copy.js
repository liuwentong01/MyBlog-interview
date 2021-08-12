//（1）深拷贝只考虑数组，对象
var arr = [1, { a: 2 }, 3];
function deepCopy(obj) {
  if (typeof obj !== "object") return obj;
  const ans = obj instanceof Array ? [] : {};
  for (let i in obj) {
    if (typeof obj[i] === "object") {
      ans[i] = deepCopy(obj[i]);
    } else {
      ans[i] = obj[i];
    }
  }
  return ans;
}
console.log(deepCopy(arr));

//(2)深拷贝考虑函数， 正则，日期