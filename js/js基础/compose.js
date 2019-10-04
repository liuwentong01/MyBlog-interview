function compose(){
  var args = arguments;
  var pos = args.length-1;
  return function(){
    var result = args[pos].apply(null, arguments);
    --pos;
    while(pos>=0){
      result = args[pos].call(null, result);
      pos--
    }
    return result;
  }
}
var fn1 = function(x){
  return x/3;
}
var fn2 = function(x){
  return x*4; 
}
var fn3 = function(x){
  return x+4;
}
var f = compose(fn1, fn2, fn3);
console.log(f(1));

function compose(){
  var args = arguments;
  var len = args.length-1;
  return function(){
    var x = arguments[0];
    var res = args[len](x);
    len--;
    while(len >= 0){
      res = args[len](res);
      len--;
    }
    return res;
  }
}