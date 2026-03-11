function quickSort(arr, L, R) {
  if (arr == null || arr.length < 2) return;
  if (L < R) {
    var cur = dutchFlag(arr, L, R);
    quickSort(arr, L, cur[0] - 1);
    quickSort(arr, cur[1] + 1, R);
  }
}
function dutchFlag(arr, L, R) {
  var less = L - 1,
    more = R;
  while (L < more) {
    if (arr[L] < arr[R]) {
      swap(arr, ++less, L++);
    } else if (arr[L] > arr[R]) {
      swap(arr, --more, L);
    } else {
      L++;
    }
  }
  swap(arr, L, R);
  return [less + 1, more];
}
function swap(arr, i, j) {
  let temp = arr[i];
  arr[i] = arr[j];
  arr[j] = temp;
}

function main() {
  var arr = [2, 15, 26, 27, 44, 19, 46, 48, 50, 3, 4, 5, 36, 38, 47, 19];
  quickSort(arr, 0, 15);
  console.log(arr);
}
main();
