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
const fn = (a, b) => {};
window.addEventListener('click', throttle(fn, 500))

//
function throttle(fn, wait) {
  let pre = 0;
  return function(){
    let args = arguments;
    let self = this;
    let now = +new Date();
    if(now - pre > wait) {
      pre = now;
      fn.apply(self, args);
    }
  }
}
