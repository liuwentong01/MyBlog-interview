# Scope Hoisting (作用域提升) — 面试流程图

> 对应文件: `scope-hoisting-demo.js`

## 1. 普通打包 vs Scope Hoisting

```mermaid
flowchart LR
    subgraph NORMAL ["普通打包"]
        N1["modules = {<br/>'math.js': (module, exports, require) => {<br/>  const add = (a, b) => a + b;<br/>  exports.add = add;<br/>},<br/>'index.js': (module, exports, require) => {<br/>  const { add } = require('./math');<br/>  console.log(add(1, 2));<br/>}<br/>}"]
        N2["3 个闭包 + modules + cache + require<br/>每次访问走 require() 函数调用"]
    end

    subgraph HOISTED ["Scope Hoisting"]
        H1["(() => {<br/>  const math_add = (a, b) => a + b;<br/>  console.log(math_add(1, 2));<br/>})();"]
        H2["0 个闭包，0 运行时<br/>直接变量引用，V8 可内联"]
    end

    NORMAL -->|"concatenateModules: true"| HOISTED

    style NORMAL fill:#f8d7da,stroke:#dc3545
    style HOISTED fill:#d4edda,stroke:#28a745
```

## 2. 为什么要做 Scope Hoisting？

```mermaid
flowchart TD
    WHY["Scope Hoisting 的 3 个好处"]

    WHY --> SIZE["1. 减少代码体积<br/>去掉每个模块的函数包装<br/>去掉 modules/cache/require 运行时<br/>示例：体积减少 53%"]

    WHY --> PERF["2. 提升运行性能<br/>require() 有函数调用 + cache 查找开销<br/>→ 变成直接变量引用<br/>V8 可以内联优化"]

    WHY --> MEM["3. 减少内存消耗<br/>100 个模块 = 100 个函数闭包<br/>→ 合并后只有 1 个 IIFE<br/>更少的作用域 = 更少的内存"]

    style WHY fill:#4a90d9,color:#fff
    style SIZE fill:#d4edda,stroke:#28a745
    style PERF fill:#d4edda,stroke:#28a745
    style MEM fill:#d4edda,stroke:#28a745
```

## 3. 合并的核心步骤

```mermaid
flowchart TD
    S1["Step 1: 分析模块依赖图<br/>判断哪些模块可以合并"]

    S2["Step 2: 生成唯一前缀<br/>math.js → math_<br/>utils.js → utils_<br/>避免变量名冲突"]

    S3["Step 3: 去掉 export 关键字<br/>export const add = ... → const math_add = ..."]

    S4["Step 4: 重命名变量<br/>所有被导出的变量加前缀<br/>add → math_add<br/>formatResult → utils_formatResult"]

    S5["Step 5: 替换消费方的引用<br/>import { add } from './math';<br/>console.log(add(1, 2));<br/>→ console.log(math_add(1, 2));"]

    S6["Step 6: 按拓扑序组装<br/>被依赖的模块在前（先声明）<br/>入口模块在后（使用变量）<br/>这就是'提升'"]

    S1 --> S2 --> S3 --> S4 --> S5 --> S6

    style S1 fill:#4a90d9,color:#fff
    style S4 fill:#f5a623,color:#fff
    style S6 fill:#d4edda,stroke:#28a745
```

## 4. 哪些模块不能合并？(Bail Out)

```mermaid
flowchart TD
    CHECK["模块能否被合并?"]

    CHECK --> C1{ESM 格式?}
    C1 -->|"CJS / AMD / UMD"| BAIL1["✗ 不能合并<br/>CJS 是动态的<br/>无法静态分析绑定关系"]

    C1 -->|"ESM"| C2{被几个 chunk 引用?}
    C2 -->|"> 1 个"| BAIL2["✗ 不能合并<br/>合并后就不能共享了<br/>会导致代码重复"]

    C2 -->|"1 个"| C3{有循环依赖?}
    C3 -->|"有"| BAIL3["✗ 不能合并<br/>变量提升顺序无法保证"]

    C3 -->|"没有"| C4{使用了 eval()?}
    C4 -->|"是"| BAIL4["✗ 不能合并<br/>eval 会访问当前作用域变量<br/>合并后作用域变了"]

    C4 -->|"否"| OK["✓ 可以合并!"]

    style CHECK fill:#4a90d9,color:#fff
    style BAIL1 fill:#f8d7da,stroke:#dc3545
    style BAIL2 fill:#f8d7da,stroke:#dc3545
    style BAIL3 fill:#f8d7da,stroke:#dc3545
    style BAIL4 fill:#f8d7da,stroke:#dc3545
    style OK fill:#d4edda,stroke:#28a745
```

## 5. 与 Tree Shaking 的关系

```mermaid
flowchart TD
    ESM["ES Module 静态特性"]

    ESM --> TS["Tree Shaking<br/>移除未使用的导出<br/>减少无用代码"]

    ESM --> SH["Scope Hoisting<br/>合并模块到同一作用域<br/>减少运行时开销"]

    TS --> BOTH["两者互补:<br/>Tree Shaking 减少'量'（删死代码）<br/>Scope Hoisting 减少'壳'（删函数包装）<br/>-------<br/>都只对 ESM 生效<br/>都在生产模式默认开启"]

    style ESM fill:#4a90d9,color:#fff
    style TS fill:#f5a623,color:#fff
    style SH fill:#f5a623,color:#fff
    style BOTH fill:#d4edda,stroke:#28a745
```

**面试要点:**
- Scope Hoisting 把多个模块合并到同一个函数作用域，去掉模块包装和 require 运行时
- 只对 ESM 生效，CJS 不行（和 Tree Shaking 一样的原因：需要静态分析）
- `optimization.concatenateModules: true`，生产模式默认开启
- Bail out 条件：非 ESM、被多 chunk 引用、循环依赖、使用 eval
- 与 Tree Shaking 互补：一个减无用代码，一个减函数包装
- 查看 bail out 原因：`--stats-optimization-bailout`
