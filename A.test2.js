Function.prototype.bind = function(context, arr) {
  var self = this;
  var fn = function() {
    var args = Array.from(arguments);
    self.apply(this instanceof F ? this : context, arr.concat(args));
  };
  function F() {}
  F.prototype = this.prototype;
  fn.prototype = new F();
  return fn;
};
