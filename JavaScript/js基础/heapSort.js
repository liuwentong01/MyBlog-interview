function heapSort(arr){
  if(arr == null || arr.length < 2){
    return;
  }
  for(let i = 0; i < arr.length; i++){
    heapInsert(arr, i);
  }
  var size = arr.length;
  swap(arr, 0, --size);
  while(size){
    heapify(arr, 0, size);
    swap(arr, 0, --size);
  }
}
function heapInsert(arr, index){
  while( index && arr[index] > arr[Math.floor( (index-1)/2 )]){
    swap(arr, index, Math.floor((index-1)/2));
    index = Math.floor((index-1)/2);
  }
}
function heapify(arr, index, size){
  var left = index * 2 + 1;
  while(left < size){
    var largest = left+1 < size && arr[left] < arr[left+1] ? left+1 : left;
    largest = arr[index] > arr[largest] ? index : largest;
    if(largest == index){
      break;
    }
    swap(arr, largest, index);
    index = largest;
    left = index * 2 +1;
  }
}
function swap(arr, i, j){
  var tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function main(){
  var arr = [3, 44, 38, 5, 47, 15, 36, 26, 27, 2, 46, 4, 19, 50, 48];
  heapSort(arr);
  console.log(arr);
}
main();