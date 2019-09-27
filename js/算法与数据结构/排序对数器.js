function generatorArray(maxSize, maxValue){
  size = Math.floor(Math.random() * maxSize);
  var arr = new Array(size);
  for(let i = 0; i < size; i++){
    arr[i] = Math.floor(Math.random() * (maxValue+1)) - Math.floor(Math.random() * maxValue);
  }
  return arr;
}
function copy(arr){
  var array = new Array(arr.length);
  if(arr == null)
    return null;
  else{
    for(let i = 0; i < arr.length; i++){
      array[i] = arr[i];
    }
  }
  return array
}
function comparator(arr){
  return arr.sort((a, b) => a-b);
}
function isEqual(arr1, arr2){
  if((arr1 == null && arr2 != null) || (arr1 != null && arr2 == null)){
    return false;
  }
  if(arr1 == null && arr2 == null){
    return true;
  }
  if(arr1.length != arr2.length){
    return false;
  }
  for(let i = 0; i < arr1.length; i++){
    if(arr1[i] != arr2[i]){
      return false;
    }
  }
  return true;
}
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


function main(){
  var testTime = 50000;
  var succ = true;
  for(let i = 0; i < testTime; i++){
    var arr1 = generatorArray(10, 10);
    var arr2 = copy(arr1);
    insertionSort(arr1);
    comparator(arr2);
    if(!isEqual(arr1, arr2)){
      console.log(arr1);      //输出错误样例
      succ = false;
    }
  }
  console.log(succ);
}
main();