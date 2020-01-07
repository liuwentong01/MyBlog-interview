/**
 * 浅拷贝: 浅复制是复制引用，复制后的引用都是指向同一个对象的实例，彼此之间的操作会互相影响
 */
//1:
let copy1 = { ...{ x: 1 } };
let copyarr = [...arr];
//2:
let copy = Object.assign({}, { x: 1 });

/**
 * 深拷贝: 深复制不是简单的复制引用，而是在堆中重新分配内存，并且把源对象实例的所有属性都进行新建复制
 * 以保证深复制的对象的引用图不包含任何原有对象或对象图上的任何对象，复制后的对象与原来的对象是完全隔离的
 * 由深复制的定义来看，深复制要求如果源对象存在对象属性，那么需要进行递归复制，从而保证复制的对象与源对象完全隔离。
 * Array的slice和concat方法都会返回一个新的数组实例，但是这两个方法对于数组中的对象元素却没有执行深复制，
 * 而只是复制了引用了，因此这两个方法并不是真正的深复制
 */
//1: JSON.stringify()/JSON.parse()
let obj = { a: 1, b: { x: 3 } };
JSON.parse(JSON.stringify(obj));

//2:递归拷贝
function deepCopy(obj){
  if(typeof obj !== 'object'){
    var result = obj;
  } else{
    var result = obj instanceof Array ? [] : {};
    for(let i in obj){
      if(obj.hasOwnProperty(i)){
        result[i] = typeof obj[i] == 'object' ? deepCopy(obj[i]) : obj[i];
      }
    }
  }
  return result;
}


/**
* deep clone
* @param  {[type]} parent object 需要进行克隆的对象
* @return {[type]}        深克隆后的对象
*/
const clone = parent => {
  // 维护两个储存循环引用的数组
  const parents = [];
  const children = [];

  const _clone = parent => {
    if (parent === null) return null;
    if (typeof parent !== 'object') return parent;

    let child, proto;

    if (isType(parent, 'Array')) {
      // 对数组做特殊处理
      child = [];
    } else if (isType(parent, 'RegExp')) {
      // 对正则对象做特殊处理
      child = new RegExp(parent.source, getRegExp(parent));
      if (parent.lastIndex) child.lastIndex = parent.lastIndex;
    } else if (isType(parent, 'Date')) {
      // 对Date对象做特殊处理
      child = new Date(parent.getTime());
    } else {
      // 处理对象原型
      proto = Object.getPrototypeOf(parent);
      // 利用Object.create切断原型链
      child = Object.create(proto);
    }

    // 处理循环引用
    const index = parents.indexOf(parent);

    if (index != -1) {
      // 如果父数组存在本对象,说明之前已经被引用过,直接返回此对象
      return children[index];
    }
    parents.push(parent);
    children.push(child);

    for (let i in parent) {
      // 递归
      child[i] = _clone(parent[i]);
    }

    return child;
  };
  return _clone(parent);
};
