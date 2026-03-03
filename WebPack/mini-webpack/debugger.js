/**
 * debugger.js —— 启动 mini-webpack 打包
 *
 * 这个文件完全对应真实 webpack 项目中的调用方式：
 *
 *   const { webpack } = require('webpack');         // 真实 webpack
 *   const { webpack } = require('./webpack');        // 我们的 mini-webpack
 *
 *   const compiler = webpack(config);  // 创建 Compiler，挂载 Plugin
 *   compiler.run(callback);            // 启动编译，完成后执行回调
 *
 * 执行方式：
 *   node debugger.js
 *   或：npm run build（package.json 中 "build": "node debugger.js"）
 */

const path = require('path');
const { webpack } = require('./webpack');           // 引入我们手写的 webpack
const webpackOptions = require('./webpack.config'); // 引入配置文件

// 1. 创建 Compiler 实例（同时挂载 webpack.config.js 中声明的所有 Plugin）
const compiler = webpack(webpackOptions);

// 2. 启动编译
//    内部流程：hooks.run → compile → emit → 写文件 → afterEmit → callback → done
compiler.run((err, stats) => {
  // err：编译过程中的严重错误（如找不到入口文件）
  if (err) {
    console.error('\n❌ 编译出错:', err.message);
    return;
  }

  // stats：编译统计信息，通过 toJson() 获取详细数据
  const result = stats.toJson();

  console.log('--- 编译产物统计 ---');
  console.log(`  模块总数：${result.modules.length} 个`);
  console.log(`  代码块数：${result.chunks.length} 个`);
  console.log(`  产出文件：${Object.keys(result.assets).join(', ')}`);

  // 打印产出目录路径，方便直接找到文件
  console.log(`\n  输出目录：${webpackOptions.output.path}`);
  console.log(`  运行命令：node ${path.join(webpackOptions.output.path, 'main.js')}`);
});
