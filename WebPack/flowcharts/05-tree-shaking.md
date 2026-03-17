# Tree Shaking — 面试流程图

> 对应文件: `tree-shaking-demo.js`

## 1. 完整 5 步流程

```mermaid
flowchart TD
    SOURCE["源码<br/>math.js: export { add, subtract, multiply, PI }<br/>index.js: import { add, subtract } from './math'"]

    SOURCE --> S1["步骤 1: 收集 providedExports<br/>(遍历每个模块自身的 export 声明)<br/>math.js → [add, subtract, multiply, PI]"]

    S1 --> S2["步骤 2: 收集 usedExports<br/>(遍历所有消费方的 import 声明)<br/>index.js 中 import { add, subtract }<br/>→ math.js.usedExports = [add, subtract]"]

    S2 --> S3["步骤 3: 标记 unused<br/>(对比 provided vs used)<br/>add ✓ used / subtract ✓ used<br/>multiply ✗ unused / PI ✗ unused"]

    S3 --> S4["步骤 4: 代码生成<br/>unused 的 export 去掉 export 关键字<br/>变成模块内的局部变量<br/>添加 /* unused harmony export */ 注释"]

    S4 --> S5["步骤 5: Terser 压缩<br/>发现 multiply, PI 是无引用局部变量<br/>作为死代码删除"]

    S5 --> RESULT["最终 bundle 中<br/>只包含 add 和 subtract 的代码"]

    style SOURCE fill:#4a90d9,color:#fff
    style S3 fill:#f5a623,color:#fff
    style S5 fill:#f8d7da,stroke:#dc3545
    style RESULT fill:#d4edda,stroke:#28a745
```

## 2. 为什么 CJS 做不了 Tree Shaking?

```mermaid
flowchart TD
    QUESTION["为什么 CommonJS 做不了 Tree Shaking?"]

    QUESTION --> LEVEL["Tree Shaking 需要分析:<br/>用了模块的【哪些导出】<br/>而不只是【依赖了哪个模块】"]

    LEVEL --> R1["原因 1: require 返回普通对象<br/>怎么访问属性是运行时行为"]

    R1 --> EX1["math.add(1,2)  → 勉强能分析<br/>math['add'](1,2) → 勉强能分析<br/>math[key](1,2)  → key 是变量, 无法分析<br/>doSomething(math) → 整个对象传走, 不知道用什么"]

    LEVEL --> R2["原因 2: require 可以在任意位置<br/>if / for / 函数体内"]

    R2 --> EX2["if (isProd) { require('./math') }<br/>→ 运行时才知道会不会执行"]

    LEVEL --> R3["原因 3: module.exports 可运行时修改"]

    R3 --> EX3["if (flag) { module.exports.multiply = fn }<br/>→ 编译期不知道最终导出哪些"]

    QUESTION --> ESM["ESM 为什么可以?"]

    ESM --> ESM1["import 必须在模块顶层 → 不存在条件导入"]
    ESM --> ESM2["导入名称必须是静态字符串 → 不存在动态 key"]
    ESM --> ESM3["导入绑定只读 → 引用关系确定"]
    ESM --> ESM4["export 必须在顶层 → 导出列表编译期 100% 确定"]

    style QUESTION fill:#4a90d9,color:#fff
    style LEVEL fill:#f5a623,color:#fff
    style R1 fill:#f8d7da,stroke:#dc3545
    style R2 fill:#f8d7da,stroke:#dc3545
    style R3 fill:#f8d7da,stroke:#dc3545
    style ESM fill:#d4edda,stroke:#28a745
```

## 3. sideEffects 标记

```mermaid
flowchart TD
    Q["模块的所有导出都 unused<br/>能不能跳过整个模块?"]

    Q -->|"不一定"| SIDE["有些模块有副作用<br/>import 了就会产生效果"]

    SIDE --> EX1["import './polyfill'<br/>→ 修改全局原型<br/>没有 export, 但 import 就生效"]
    SIDE --> EX2["import './style.css'<br/>→ 注入样式<br/>没有 export, 但 import 就生效"]

    Q --> CONFIG["package.json 中声明"]

    CONFIG --> CF1["sideEffects: false<br/>→ 所有模块都没副作用<br/>→ 导出全 unused 就整个跳过"]

    CONFIG --> CF2["sideEffects: ['*.css', './polyfill.js']<br/>→ 这些有副作用, 不跳过<br/>→ 其余文件导出 unused 可安全跳过"]

    CF1 --> EFFECT["效果:<br/>lodash-es 比 lodash 小得多<br/>就是因为 sideEffects: false"]

    style Q fill:#4a90d9,color:#fff
    style SIDE fill:#f8d7da,stroke:#dc3545
    style EFFECT fill:#d4edda,stroke:#28a745
```

## 4. 为什么 provided 和 used 不能一次遍历收集?

```mermaid
flowchart LR
    subgraph PASS1 ["第一遍: 各模块独立收集 providedExports"]
        P1["math.js 分析自己的 export<br/>→ [add, subtract, multiply, PI]"]
        P2["index.js 分析自己的 export<br/>→ []"]
    end

    subgraph PASS2 ["第二遍: 遍历所有模块收集 usedExports"]
        U1["遍历 index.js 发现:<br/>import { add, subtract } from './math'<br/>→ 这是 math.js 的 usedExports, 不是 index.js 的"]
    end

    PASS1 -->|"数据流方向不同"| PASS2

    style PASS1 fill:#e8f4fd,stroke:#4a90d9
    style PASS2 fill:#fff3cd,stroke:#ffc107
```

**面试要点:**
- Tree Shaking 基于 **ESM 的静态结构**, CJS 做不到因为属性访问和导出都是运行时行为
- 流程: 收集 provided → 收集 used → 标记 unused → 去 export → Terser 删死代码
- `sideEffects: false` 允许 webpack 跳过导出全 unused 的整个模块
- webpack 真实实现分两阶段: build 阶段记录 exports, seal 阶段标记 usedExports
