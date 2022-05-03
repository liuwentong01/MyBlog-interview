function mergeSort(arr, l, r) {
  if (arr == null || arr.length < 2) {
    return;
  }
  if (l < r) {
    var mid = Math.floor((l + r) / 2);
    mergeSort(arr, l, mid);
    mergeSort(arr, mid + 1, r);
    merge(arr, l, mid, r);
  }
}
function merge(arr, l, m, r) {
  var help = new Array(r - l + 1);
  var p1 = l,
    p2 = m + 1,
    i = 0;
  while (p1 <= m && p2 <= r) {
    if (arr[p2] > arr[p1]) {
      sum += arr[p1] * (r - p2 + 1);
    }
    help[i++] = arr[p2] > arr[p1] ? arr[p1++] : arr[p2++];
  }
  while (p1 <= m) {
    help[i++] = arr[p1++];
  }
  while (p2 <= r) {
    help[i++] = arr[p2++];
  }
  for (let i = 0; i < help.length; i++) {
    arr[l + i] = help[i];
  }
}
function main() {
  var arr = [3, 44, 38, 5, 47, 15, 36, 26, 27, 2, 46, 4, 19, 50, 48];
  mergeSort(arr, 0, arr.length - 1);
  console.log(arr);
  console.log(sum);
}
var sum = 0;
main();
