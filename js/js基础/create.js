/**Object.create()方法的实现 */
function create(obj){
  function F(){};
  F.prototype = obj;
  return new F();
}