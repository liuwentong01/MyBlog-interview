var class2type = {};
"Boolean Number String Function Array Date RegExp Object Error".split("")
  .map(function(item, index) {
    class2type["[object " + item + "]"] = item.toLowerCase();
  });
function type(obj) {
  if (obj == null) {
    return obj + "";
  }
  return typeof obj === "object" || typeof obj === "function"
    ? class2type[Object.prototype.toString.call(obj)] || "object"
    : typeof obj;
}
var a = Symbol(),
  b = 1,
  c = {},
  d = "string",
  e = function() {};//object
type(e);
