/**
 * ES Module加载器演示 (ES Module Loader Demo)
 *
 * 这段代码模拟了webpack处理ES Module的机制，展示了：
 * 1. 如何将ES Module转换为CommonJS格式
 * 2. 如何通过Object.defineProperty实现命名导出
 * 3. 如何标识模块类型为ES Module
 * 4. 如何实现default导出和命名导出的互操作性
 */

// ============ 模块定义 ============
var modules = {
  "./src/name.js": (module, exports, require) => {
    // 重要！！！必须先定义常量，再使用它们
    // 这些常量对应ES Module中的导出变量
    const author = "不要秃头啊";
    const age = "18";
    const DEFAULT_EXPORT = author;

    // 1. 给该模块设置tag：标识这是一个ES Module
    require.setModuleTag(exports);

    // 2. 通过Object.defineProperty给exports设置属性
    // 使用getter函数可以实现live binding（动态绑定）
    require.defineProperty(exports, {
      age: () => age, // 命名导出: export const age
      default: () => DEFAULT_EXPORT, // 默认导出: export default
    });
  },
};

// ============ 模块缓存 ============
var cache = {};

// ============ require函数实现 ============
/**
 * 模块加载函数
 * @param {string} modulePath - 模块的路径
 * @returns {any} 返回模块导出的内容
 */
function require(modulePath) {
  // 检查缓存
  var cachedModule = cache[modulePath];
  if (cachedModule !== undefined) {
    return cachedModule.exports;
  }

  // 创建模块对象（赋值表达式 { exports: {},}会被返回， 再次赋值给module）
  var module = (cache[modulePath] = {
    exports: {},
  });

  // 执行模块代码
  modules[modulePath](module, module.exports, require);

  // 返回导出内容
  return module.exports;
}

// ============ require辅助方法 ============

/**
 * 对exports对象做代理，设置getter属性
 * 这样可以实现ES Module的live binding特性
 * @param {object} exports - 导出对象
 * @param {object} definition - 属性定义对象，key是属性名，value是getter函数
 */
require.defineProperty = (exports, definition) => {
  for (var key in definition) {
    Object.defineProperty(exports, key, {
      enumerable: true, // 可枚举
      get: definition[key], // getter函数，实现动态绑定
    });
  }
};

/**
 * 标识模块的类型为ES Module
 * 通过设置Symbol.toStringTag和__esModule标识
 * @param {object} exports - 导出对象
 */
require.setModuleTag = (exports) => {
  // 设置Symbol.toStringTag，使Object.prototype.toString返回[object Module]
  Object.defineProperty(exports, Symbol.toStringTag, {
    value: "Module",
  });

  // 设置__esModule标识，表明这是一个ES Module
  // 这个标识用于区分ES Module和CommonJS Module
  Object.defineProperty(exports, "__esModule", {
    value: true,
  });
};

// ============ 模块使用示例 ============
// 以下是main.js编译后的代码

// 加载模块，拿到模块导出对象exports
var _name__WEBPACK_IMPORTED_MODULE_0__ = require("./src/name.js");

// 访问default导出（对应 import author from './src/name.js'）
console.log(_name__WEBPACK_IMPORTED_MODULE_0__["default"], "author"); // 输出: 不要秃头啊 author

// 访问命名导出（对应 import { age } from './src/name.js'）
console.log(_name__WEBPACK_IMPORTED_MODULE_0__.age, "age"); // 输出: 18 age

// a.js
const b = require("./b");

// b.js
const a = require("./a");
