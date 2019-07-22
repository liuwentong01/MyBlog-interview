function selectionSort(arr){
  for(var i = 0; i < arr.length; i++){
    var min = arr[i];
    var minindex = i;
    for(var j = i + 1; j <arr.length; j++){
      if(min > arr[j]){
        min = arr[j];
        minindex = j;
      }
    }
    var temp = arr[i];
    arr[i] = min;
    arr[minindex] = temp;
  }
  return arr;
}

var arr = [3, 44, 38, 5, 47, 15, 36, 26, 27, 2, 46, 4, 19, 50, 48];
console.log(selectionSort(arr));