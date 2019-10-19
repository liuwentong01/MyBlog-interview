var arr = Array.from(document.getElementsByTagName("*"));
var obj = {};
for (let i = 0; i < arr.length; i++) {
  key = arr[i].tagName;
  if (typeof obj[key] !== "number") {
    obj[key] = 0;
  }
  obj[key]++;
}

var array = [];
k = "";
for (let i in obj) {
  //对象转数组for ... in 
  var temp = {
    name: i,
    count: obj[i]
  };
  array.push(temp);
}
var obj2 = {};
array.sort((a, b) => a.count - b.count);
array.forEach(function(v) {
  obj2[v.name] = v.count;
});
console.log(obj2);
