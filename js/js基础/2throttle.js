function throttle(fn, wait) {
  var pre = 0;
  return function() {
    var now = +new Date();
    var self = this;
    var args = arguments;
    if (now - pre > wait) {
      fn.apply(self, args);
      pre = now;
    }
  };
}
