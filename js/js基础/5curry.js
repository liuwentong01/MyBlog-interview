function createCurry(fn, arr) {
  var len = fn.length;
  arr = arr || [];
  return function() {
    arr = arr.concat([...arguments]);
    if (arr.length < len) {
      return createCurry(fn, arr);
    } else {
      return fn(...arr);
    }
  };
}

var addCurry = createCurry(function add(a, b, c, d, e) {
  return a + b + c + d + e;
});
console.log(addCurry(1)(2)(3, 4)(2));
