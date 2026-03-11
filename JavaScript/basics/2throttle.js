function throttle(fn, wait) {
  var pre = 0;
  return function () {
    var now = +new Date();
    var self = this;
    var args = arguments;
    if (now - pre > wait) {
      fn.apply(self, args);
      pre = now;
    }
  };
}
const fn = (a, b) => {};
window.addEventListener("click", throttle(fn, 500));

// TODO 有点难，晚点看。。。优化版本：
// 1. 同时支持 leading（前缘）和 trailing（后缘）触发
// 2. +new Date() -> Date.now()
// 3. var -> let/const, arguments -> rest 参数
// 4. 增加 cancel 方法
// 5. trailing 保证最后一次调用不丢失
function throttleOptimized(fn, wait, { leading = true, trailing = true } = {}) {
  let timer = null;
  let previous = 0;

  const throttled = function (...args) {
    const now = Date.now();

    if (!previous && !leading) previous = now;

    const remaining = wait - (now - previous);

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      previous = now;
      fn.apply(this, args);
    } else if (!timer && trailing) {
      timer = setTimeout(() => {
        previous = leading ? Date.now() : 0;
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };

  throttled.cancel = function () {
    clearTimeout(timer);
    timer = null;
    previous = 0;
  };

  return throttled;
}
