/********************************instanceof函数实现**************** */
function instanceOf(x, y){
  if(typeof x == 'function') return false;
  while(x.__proto__ !== null){
    if(x.__proto__ === y.prototype){
      return true;
    }
    x = x.__proto__;
  }
  return false;
}















