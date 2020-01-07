/*当 bind 返回的函数作为构造函数的时候，bind 时指定的 this 值会失效，但传入的参数依然生效。*/
Function.prototype.bind2 = function(context) {
  var self = this;
  var args = Array.prototype.slice.call(arguments, 1);
  var fn = function() {
    var bindArgs = Array.prototype.slice.call(arguments);
    return self.apply(
      this instanceof F ? this : context,
      args.concat(bindArgs)
    );
  };
  var F = function() {};
  F.prototype = this.prototype;
  fn.prototype = new F();
  return fn;
};