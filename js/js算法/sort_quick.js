function quickSort0(arr, low, high){
  var i = low, j = high;
  var baseValue = arr[low];
  if(i >= j){
    return arr;
  }
  while(i != j){
    while(i<j && arr[j] >= baseValue) j--;
    while(i<j && arr[i] <= baseValue) i++;
    if(i < j){
      var temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
  }
  arr[low] = arr[i];
  arr[i] = baseValue;
  quickSort0(arr, low, i-1);
  quickSort0(arr,i+1, high);
  return arr;
}
var arr = [3, 44, 38, 5, 47, 15, 36, 26, 27, 2, 46, 4, 19, 50, 48];
console.log(quickSort0(arr, 0, 14));