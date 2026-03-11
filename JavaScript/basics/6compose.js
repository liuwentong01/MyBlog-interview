// function compose(){
//   var args = arguments;
//   var pos = args.length-1;
//   return function(){
//     var result = args[pos].apply(null, arguments);
//     --pos;
//     while(pos>=0){
//       result = args[pos].call(null, result);
//       pos--
//     }
//     return result;
//   }
// }

function compose() {
  var args = Array.prototype.slice.call(arguments);
  return function(res) {
    for (let i = args.length - 1; i >= 0; i--) {
      res = args[i](res);
    }
    return res;
  };
}

var fn1 = function(x) {
  return x / 3;
};
var fn2 = function(x) {
  return x * 4;
};
var fn3 = function(x) {
  return x + 4;
};
3;
var f = compose(fn1, fn2, fn3);
console.log(f(1));
