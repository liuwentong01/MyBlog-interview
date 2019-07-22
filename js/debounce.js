/**函数去抖 */
/**
 * 防抖原理： 尽管触发事件，只有在事件触发的n秒后才执行，如果在这期间内又有事件触发,则以新触发的的事件时间为准，
 * 总之，就是在触发后的n秒内不触发事件，程序才会执行。
 */
var count = 0;
document.body.addEventListener("mousemove",debounce(handleMousemove, 100, true));
function handleMousemove(){
  document.querySelector("h1").innerHTML = count++;
}

function debounce(func, wait, immediate) {
  var timeout, result;
  return function() {
    var context = this;
    var args = arguments;
    if (timeout) clearTimeout(timeout);
    if (immediate) {
      var callNow = !timeout;
      timeout = setTimeout(function() {
        timeout = null;
      }, wait);
      if (callNow) result = func.apply(context, args);
    } else {
      timeout = setTimeout(function() {
        func.apply(context, args); //这里不能返回result，因为在setTimeout里调用的会返回undefined;
      }, wait);
    }
    return result;

  };
}

/********************************** */
let DFSdeepClone = (obj, visitedArr = []) => {
  let _obj = {};
  if (isTypeOf(obj, "array") || isTypeOf(obj, "object")) {
    let index = visitedArr.indexOf(obj);
    _obj = isTypeOf(obj, "array") ? [] : {};
    if (~index) {
      // 判断环状数据
      _obj = visitedArr[index];
    } else {
      visitedArr.push(obj);
      for (let item in obj) {
        _obj[item] = DFSdeepClone(obj[item], visitedArr);
      }
    }
  } else if (isTypeOf(obj, "function")) {
    _obj = eval("(" + obj.toString() + ")");
  } else {
    _obj = obj;
  }
  return _obj;
};