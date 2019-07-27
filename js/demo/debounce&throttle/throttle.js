/**
 * throttle节流
 * 节流原理：如果你持续触发事件则一段时间只触发一次事件
 * 关于节流有两种实现方式一个是时间戳，另一种是设置定时器
 */

var count = 0;
document.body.addEventListener(
  "mousemove",
  throttle(handleMousemove, 500)
);
function handleMousemove() {
  document.querySelector("h1").innerHTML = count++;
}
/*第一种，时间戳 */
function throttle(func, wait) {
  var context, args;
  var previous = 0;
  return function() {
    var now = +new Date();
    context = this;
    args = arguments;
    if (now - previous > wait) {
      func.apply(context, args);
      previous = now;
    }
  };
}

/**第二种，定时器 */