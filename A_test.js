//快速幂
function as(x,n){
  var res = 1;
  while(n){
    if(n & 1) res *= x;
    x *= x;
    n >>= 1; 
  }
  console.log(res);
}
