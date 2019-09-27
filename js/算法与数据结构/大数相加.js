function add(a,b){
  var a = a.toString().split('');
  var b = b.toString().split('');
  var res = '', temp = 0;
  while(a.length || b.length || temp){
    temp += ~~a.pop() + ~~b.pop();
    res = (temp%10) + res;
    temp  =  temp > 9;
  }
  return res;
}
console.log(add(1111111111,1111111111));

/*split把两个大数转化成数组，里面存的是字符串
*pop取出最后一位相加
*~~将字符转化成数字 ，可以相加
*循环取出相加
*/