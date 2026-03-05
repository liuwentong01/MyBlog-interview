const getMessage = require('./message');

const result = getMessage('World');
console.log(result);

// ── 动态 import 演示 ──────────────────────────────────────────────────────
// import() 返回 Promise，模块会被拆成单独的 async chunk，运行时按需加载。
// mini-webpack 会把 import('./lazy-module') 编译为：
//   __webpack_require__.e("chunk-0").then(() => __webpack_require__("./src/lazy-module.js"))
import('./lazy-module').then(function (lazy) {
  console.log(lazy.lazyGreeting('Dynamic Import'));
});
