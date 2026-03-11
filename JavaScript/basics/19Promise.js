//方法1
function sum(n) {
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += i;
  }
  return sum;
}
//方法2
function sum(n) {
  return ((1 + n) / 2) * n;
}
