/**外部只能通过方法访问到age，不能直接访问到 */
function People(num) { // 构造器
  var age = num;
  this.getAge = function() {
    return age;
  };
  this.addAge = function() {
    age++;
  };
}
var lionel = new People(23); // new方法会固化this为lionel哦
lionel.addAge();
console.log(lionel.age);      // undefined
console.log(lionel.getAge()); // 24

/**闭包模仿块级作用域 */
var arr = ["a", "b", "c", "d", "e"];
for (var i = 0; i < arr.length; i++) {
  (function(j) {
    var item = arr[j];
    setTimeout(function() {
      console.log(item);
    }, 1000 * (i + 1));
  })(i);
}
