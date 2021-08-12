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
        fn.apply(self, args); // 为了让fn函数里this拿到该dom
      }, wait);
    }
  };
}

window.addEventListener('scroll', debounce(fn, 500, false))
