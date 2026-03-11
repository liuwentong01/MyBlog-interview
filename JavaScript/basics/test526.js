let a = "a5".split("");
let max = 0;
let tmp = 0;
let count = 0;
for (let i = 0; i < a.length; i++) {
  if (isNaN(parseInt(a[i]))) {
    count++;
  }
}
if (count === a.length) {
  return -1;
}
for (let i = 0; i < a.length; i++) {
  if (isNaN(parseInt(a[i]))) {
    a[i] = "0";
    // console.log(i, a[i], '为撒谎')
  } else {
    continue;
  }
  console.log(a);
  for (let j = 0; j < a.length; j++) {
    if (!isNaN(parseInt(a[j]))) {
      console.log(a[j], "@1");
      tmp++;
    } else {
      tmp = 0;
    }
    max = Math.max(tmp, max);
  }
  a[i] = "a";
}
console.log(max);
console.log(111);
