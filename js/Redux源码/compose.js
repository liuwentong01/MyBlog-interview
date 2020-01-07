export default function compose(...funcs) {
  var len = funcs.length;
  if(len == 0){
    return args => args;
  }
  if(len == 1){
    return funcs[0];
  }
  const last = funcs[len-1];
  const rest = funcs.slice(0, -1);
  return (...args) => rest.reduceRight((pre, f) => {return f(pre)}, last(...args))
}