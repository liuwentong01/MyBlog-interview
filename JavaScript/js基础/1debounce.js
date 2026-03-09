function debounce(fn, wait, flag) {
  var timer;
  return function () {
    var self = this;
    var args = arguments;
    if (timer) clearTimeout(timer);
    if (flag) {
      var callNow = !timer;
      timer = setTimeout(() => {
        timer = null;
      }, wait);
      if (callNow) fn.apply(self, args);
    } else {
      timer = setTimeout(() => {
        fn.apply(self, args);
      }, wait);
    }
  };
}

// 优化版本：
// 1. flag -> immediate，语义更清晰
// 2. var -> let/const，arguments -> rest 参数
// 3. 保留 fn 返回值
// 4. 增加 cancel 方法支持手动取消
function debounceOptimized(fn, wait, immediate = false) {
  let timer = null;
  let result;

  const debounced = function (...args) {
    if (timer) clearTimeout(timer);

    if (immediate) {
      const callNow = !timer;
      timer = setTimeout(() => {
        timer = null;
      }, wait);
      if (callNow) result = fn.apply(this, args);
    } else {
      timer = setTimeout(() => {
        fn.apply(this, args);
      }, wait);
    }

    return result;
  };

  debounced.cancel = function () {
    clearTimeout(timer);
    timer = null;
  };

  return debounced;
}
