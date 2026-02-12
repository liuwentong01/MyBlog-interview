/**
 * 模块加载器演示 (Module Loader Demo)
 * 
 * 这段代码模拟了webpack的模块加载机制，展示了：
 * 1. 如何定义模块
 * 2. 如何实现模块缓存
 * 3. 如何通过require函数加载模块
 */

// ============ 模块定义 ============
// 定义一个模块映射对象，key是模块路径，value是模块的工厂函数
// 注意：这里的函数签名需要接收三个参数 (module, exports, require)
var modules = {
  "./src/name.js": (module, exports, require) => {
    // 将导出的内容赋值给module.exports
    module.exports = "不要秃头啊";
  },
};

// ============ 模块缓存 ============
// 缓存对象，用于存储已经加载过的模块，避免重复执行模块代码
var cache = {};

// ============ require函数实现 ============
/**
 * 模块加载函数
 * @param {string} modulePath - 模块的路径
 * @returns {any} 返回模块导出的内容
 */
function require(modulePath) {
  // 1. 检查缓存：获取已缓存的模块
  var cachedModule = cache[modulePath];
  if (cachedModule !== undefined) {
    // 如果有缓存，则不重新执行模块内容，直接return导出的值
    return cachedModule.exports;
  }

  // 2. 创建模块对象：如果没有缓存，则定义module对象和exports属性
  // 重要！！！这里 module = cache[modulePath] 表示两者引用同一个内存地址
  // 这样当模块代码执行并修改module.exports时，cache中的对象也会同步更新
  var module = (cache[modulePath] = {
    exports: {}, // 初始化exports为空对象
  });

  // 3. 执行模块代码：运行模块工厂函数
  // 模块内的代码会给module.exports对象赋值
  // 传入三个参数：module对象、exports对象、require函数（支持模块间相互引用）
  modules[modulePath](module, module.exports, require);

  // 4. 返回导出内容：返回module.exports对象
  return module.exports;
}

// ============ 模块使用示例 ============
// 使用立即执行函数(IIFE)来演示模块的使用
(() => {
  // 通过require函数加载模块
  let author = require("./src/name.js");
  console.log(author, "author"); // 输出: 不要秃头啊 author
})();
