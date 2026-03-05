// 动态 import() 目标模块 —— 演示 Code Splitting
// 这个模块不会被打进主 bundle，而是单独生成一个 async chunk
// 运行时通过 __webpack_require__.e() 按需加载

module.exports = {
  lazyGreeting: function (name) {
    return 'Hello from lazy-loaded module, ' + name + '!';
  },
};
