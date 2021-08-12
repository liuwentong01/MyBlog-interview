function sum(a, b) {
  var arra = a.split("");
  var arrb = b.split("");
  var c = 0,
    res = "";
  while (arra.length || arrb.length || c) {
    var c = ~~arra.pop() + ~~arrb.pop() + c;
    res = (c % 10) + res;
    c = c > 9;
  }
  return res;
}
console.log(sum("11111", "222222"));
