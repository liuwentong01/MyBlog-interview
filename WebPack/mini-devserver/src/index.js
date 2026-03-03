var name = require('./name');
var age = require('./age');

function render() {
  var name = require('./name');
  var age = require('./age');
  document.getElementById('root').innerText = '作者: ' + name + '，年龄: ' + age;
}

render();

// HMR 关键代码：声明当依赖模块更新时的处理逻辑
// 如果不写这段，模块变化时只能整页刷新
if (module.hot) {
  module.hot.accept('./name', function () {
    console.log('[业务代码] name 模块更新了，重新渲染');
    render();
  });

  module.hot.accept('./age', function () {
    console.log('[业务代码] age 模块更新了，重新渲染');
    render();
  });
}
