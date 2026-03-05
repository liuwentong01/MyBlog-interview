// ESM 入口文件 —— 演示 import/export 识别 + Tree Shaking
//
// 只 import 了 add 和 subtract，没有 import multiply 和 PI
// → tree shaking 应该移除 math.js 中的 multiply 和 PI

import { add, subtract } from './math';
import greet from './esm-greeting';

const result = add(1, 2);
const diff = subtract(5, 3);
const msg = greet('ESM World');

console.log(`${msg} add(1,2)=${result}, subtract(5,3)=${diff}`);
