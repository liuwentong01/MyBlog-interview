const greeting = require('./greeting');

module.exports = function getMessage(name) {
  const greet = greeting(name);
  return `${greet} 这是来自 mini-webpack 的打包测试！`;
};
