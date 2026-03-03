/**
 * webpack.config.js —— mini-webpack 配置文件
 *
 * 与真实 webpack 的配置完全对应，用于演示各项功能：
 *   - entry / output   基本配置
 *   - plugins          Plugin 系统（生命周期钩子）
 *   - module.rules     Loader 系统（文件转换）
 *   - resolve          模块路径解析配置
 */

const path = require('path');
const {
  WebpackRunPlugin, // run 钩子：编译开始时打印日志
  WebpackDonePlugin, // done 钩子：编译完成时打印日志
  ManifestPlugin,   // emit 钩子：自动生成 manifest.json（★ 演示 emit 钩子的核心用法）
  commentLoader,    // Loader 示例：在每个 JS 文件末尾追加注释
} = require('./webpack');

module.exports = {
  // ── 模式 ──────────────────────────────────────────────────────────────────
  // 'development'：开发模式（不压缩代码，方便调试）
  // 'production'：生产模式（真实 webpack 会压缩代码，这里暂未实现）
  mode: 'development',

  // ── 入口（entry）─────────────────────────────────────────────────────────
  //
  // 支持两种写法：
  //
  // 1. 字符串（单入口）：chunk 名默认为 'main'
  //      entry: './src/index.js'
  //
  // 2. 对象（多入口）：可自定义 chunk 名，每个入口产出独立的 bundle
  //      entry: {
  //        app:   './src/index.js',
  //        admin: './src/admin.js',
  //      }
  //
  // 本例使用单入口，产出文件名为 main.js（[name] = 'main'）
  entry: './src/index.js',

  // ── 输出（output）────────────────────────────────────────────────────────
  output: {
    // 产出文件存放目录（绝对路径）
    path: path.resolve(__dirname, 'dist'),

    // 产出文件名，支持以下占位符：
    //   [name]        → chunk 名称，如 'main'
    //   [hash]        → 基于 bundle 内容的 8 位哈希，如 'a3f2b1c9'
    //   [contenthash] → 同 [hash]（本实现中与 [hash] 相同）
    //
    // 示例：
    //   '[name].js'          → main.js
    //   '[name].[hash].js'   → main.a3f2b1c9.js（内容变化时哈希才变，适合浏览器缓存）
    filename: '[name].js',
  },

  // ── 插件（plugins）───────────────────────────────────────────────────────
  //
  // Plugin 的作用：在 webpack 生命周期的特定时机执行自定义逻辑。
  //
  // Plugin 规范：必须是一个带有 apply(compiler) 方法的类实例。
  //   apply 方法接收 compiler，然后向钩子注册回调。
  //
  // 执行顺序：按数组顺序挂载，但实际触发顺序由钩子类型决定（SyncHook 按注册顺序）。
  plugins: [
    // ① 编译开始时打印 "🚀 开始编译..." 日志
    new WebpackRunPlugin(),

    // ② 编译完成时打印 "🎉 编译完成！" 日志
    new WebpackDonePlugin(),

    // ③ ★ 核心示例：在写文件之前（emit 钩子），自动生成 manifest.json
    //
    // manifest.json 的内容示例：
    //   {
    //     "main.js": { "size": 1234 },
    //     "manifest.json": { "size": 56 }
    //   }
    //
    // 这展示了 emit 钩子最重要的能力：
    //   Plugin 可以在写文件前往 assets 里追加新文件，
    //   Compiler 会统一将所有 assets 写入磁盘。
    //
    // 真实场景中，HtmlWebpackPlugin 就是用同样的方式生成 index.html 的。
    new ManifestPlugin(),
  ],

  // ── Loader 规则（module.rules）────────────────────────────────────────────
  //
  // Loader 的作用：在 webpack 处理模块之前，对源代码进行转换。
  //
  // 规则说明：
  //   test：正则表达式，匹配文件路径（如 /\.js$/ 匹配所有 .js 文件）
  //   use： Loader 数组，从右到左依次执行（即最后一个 Loader 最先执行）
  //
  // 执行顺序示例（use: [A, B, C]）：
  //   原始代码 → C(source) → B(result) → A(result) → 最终代码
  //
  // 真实场景中的用法：
  //   { test: /\.ts$/,   use: ['ts-loader'] }                  // TypeScript 转 JS
  //   { test: /\.scss$/, use: ['style-loader', 'css-loader', 'sass-loader'] }
  module: {
    rules: [
      {
        test: /\.js$/,       // 匹配所有 .js 文件
        use: [commentLoader], // 在文件末尾追加注释（演示 Loader 的基本用法）
      },
    ],
  },

  // ── 路径解析（resolve）────────────────────────────────────────────────────
  //
  // extensions：当 require() 省略扩展名时，按顺序尝试这些扩展名。
  //
  // 例：require('./utils')
  //   → 先尝试 ./utils        （有扩展名则直接使用）
  //   → 再尝试 ./utils.js
  //   → 再尝试 ./utils.json
  //   → 都找不到则报错
  resolve: {
    extensions: ['.js', '.json'],
  },
};
