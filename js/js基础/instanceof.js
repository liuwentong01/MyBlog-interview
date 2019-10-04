/********************************instanceof函数实现**************** */
function instanceOf(x, y){
  while(x.__proto__ !== null){
    if(x.__proto__ === y.prototype){
      return true;
    }
    x.__proto__ = x.__proto__.__proto__;
  }
  return false;
}















