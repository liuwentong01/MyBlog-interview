<<<<<<< HEAD
//组合继承

//原型继承
function Func(o){
  var F = function(){};
  F.prototype = o;
  return new F();
}

//寄生继承
function createAnother(original) {
  var clone = object(original); //通过调用object函数创建一个新对象
  clone.sayHi = function() {
    //以某种方式来增强这个对象
    alert("hi");
  };
  return clone; //返回这个对象
}


//寄生组合继承
=======
// 1原型链继承
function Animal() {
  this.colors = ["black", "white"];
}
Animal.prototype.getColor = function () {
  return this.colors;
};
function Dog() {}
Dog.prototype = new Animal();

let dog1 = new Dog();


// 2组合继承
function Animal(name, age) {
  this.name = "11";
  this.age = age;
}
Animal.prototype.sayName = function() {
  return this.name;
};
Dog.prototype = new Animal(); // 改为Object.create(Animal.prototype)就是寄生组合继承；少调用一次父构造函数
function Dog(name, age, weight) {
  Animal.call(this, name, age);
  this.weight = weight;
}

var myDog = new Dog("name111", "age111", "weight111");
console.log(myDog.sayName());



// 4类继承
class Animal {
  constructor(name) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
}
class Dog extends Animal {
  constructor(name, age) {
    super(name);
    this.age = age;
  }
}
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903

