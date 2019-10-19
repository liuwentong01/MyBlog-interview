/**********************************bind模拟实现***********************************************/
Function.prototype.bind2 = function(context, ...arr) {
  var self = this;
  var args = arr;
  var fbound = function() {
    self.apply(
      this instanceof self ? this : context,
      args.concat([...arguments])
    );
  };
  var fNOP = function() {};
  fNOP.prototype = this.prototype;
  fbound.prototype = new fNOP();
  return fbound;
};
