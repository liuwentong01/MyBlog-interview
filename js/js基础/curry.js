// function createCurry(func, args) {
//   var len = func.length;
//   var args = args || [];
//   return function() {
//     args = args.concat([...arguments]);
//     if (args.length < len) {
//       return createCurry(func, args);
//     }
//     return func(...args);
//   };
// }



function createCurry(fn, arr){
  var len = fn.length;
  arr = arr || [];
  return function(){
    arr = arr.concat([...arguments]);
    if(arr.length < len){
      return createCurry(fn, arr);
    } else{
      return fn(...arr);
    }
  }
}


var addCurry=createCurry(function(a, b, c,d,e) {
    return a + b + c + d+e;
});
console.log( addCurry(1)(2)(3,4)(2) );  


