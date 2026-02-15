function dutchFlag(arr, L, R, num){
  var less = L-1, more = R+1;
  var cur = L;
  while(cur < more){
    if(arr[cur] < num){
      swap(arr, ++less, cur++);
    } else if(arr[cur] > num){
      swap(arr, --more, cur)
    } else{
      cur++;
    }
  }
  return [less+1, more-1];
}
function swap(arr, l, r){
  let temp = arr[l];
  arr[l] = arr[r];
  arr[r] = temp;
}