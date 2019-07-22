function quickSort0(arr, low, high) {
  let i = low; //哨兵
  let j = high; //哨兵
  let pivot = arr[low];
  if (i >= j) {
    return;
  }
  while (i != j) {
    while (i < j && arr[j] >= pivot) j--;
    while (i < j && arr[i] <= pivot) i++;
    if (i < j) {
      let temp = arr[j];
      arr[j] = arr[i];
      arr[i] = temp;
    }
  }
  arr[low] = arr[i]; //每一次排序后将基准点放在正确的位置
  arr[i] = pivot;
  quickSort0(arr, low, i - 1);
  quickSort0(arr, i + 1, high);
  return arr;
}
var arr = [3, 44, 38, 5, 47, 15, 36, 26, 27, 2, 46, 4, 19, 50, 48];
console.log(quickSort0(arr, 0, 14));