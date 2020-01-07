function compose(func){
  return function
}

function A(a){
  return a+5;
}
function B(b){
  return b*5;
}
function C(c){
  return c-5;
}

compose( C(B(A(1))) )