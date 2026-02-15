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

// test

function debounce(fn, wait) {
  var timer;
  return function () {
    var self = this;
    var args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(self, args);
    }, wait);
  };
}
