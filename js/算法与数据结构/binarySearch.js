function binarySearch(arr, target){
  var left = 0, right = arr.length-1;
  while(left <= right){
    var mid = Math.floor((left+right)/2);
    if(arr[mid] > target){
      right = mid - 1;
    } else if(arr[mid] < target){
      left = mid + 1;
    } else{
      return mid;
    }
  }
  return -1;
}
var arr = [1,2,3,4,5];
console.log(binarySearch(arr, 5));
