// ESM 命名导出示例 —— 用于演示 Tree Shaking
// add 和 subtract 会被 esm-index.js 使用
// multiply 和 PI 不会被任何模块使用，打包时会被 tree shaking 移除

export const add = (a, b) => a + b;

export const subtract = (a, b) => a - b;

export const multiply = (a, b) => a * b;

export const PI = 3.14159;
