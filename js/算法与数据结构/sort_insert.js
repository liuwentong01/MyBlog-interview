function insertionSort(array) {
  for (var i = 1; i < array.length; i++) {
    for (j = i - 1; j >= 0 && array[j] > array[j + 1]; j--) {
      var temp = array[j];
      array[j] = array[j + 1];
      array[j + 1] = temp;
    }
  }
  return array;
}

var arr = [3, 44, 38, 5, 47, 15, 36, 26, 27, 2, 46, 4, 19, 50, 48];
console.log(insertionSort(arr));
