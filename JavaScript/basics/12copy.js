// ======================== 浅拷贝 ========================
// 复制引用，嵌套对象仍指向同一内存

// 1. 展开运算符
let copy1 = { ...{ x: 1 } };
let copyArr = [...[1, 2, 3]];

// 2. Object.assign
let copy2 = Object.assign({}, { x: 1 });


// ======================== 深拷贝 ========================

// 方法一：JSON 序列化（简单场景够用）
// 局限：无法处理 undefined、函数、Symbol、循环引用、Date、RegExp 等
let obj = { a: 1, b: { x: 3 } };
let obj2 = JSON.parse(JSON.stringify(obj));


// 方法二：基础递归版（只处理普通对象和数组）
function deepCloneBasic(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  const result = Array.isArray(obj) ? [] : {};
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = deepCloneBasic(obj[key]);
    }
  }
  return result;
}

var arr = [1, { a: 2 }, 3];
console.log(deepCloneBasic(arr));


// 方法三：完整版（处理循环引用、Date、RegExp、原型链）
function deepClone(obj, map = new WeakMap()) {
  if (obj === null || typeof obj !== "object") return obj;

  // 处理循环引用
  if (map.has(obj)) return map.get(obj);

  // 处理特殊类型
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags);

  // 保持原型链
  const clone = Array.isArray(obj)
    ? []
    : Object.create(Object.getPrototypeOf(obj));

  map.set(obj, clone);

  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      clone[key] = deepClone(obj[key], map);
    }
  }
  return clone;
}

// 测试循环引用
var a = { name: "a" };
a.self = a;
var b = deepClone(a);
console.log(b.name);       // 'a'
console.log(b.self === b); // true（循环引用正确复制）
console.log(b === a);      // false
