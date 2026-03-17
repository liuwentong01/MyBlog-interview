# 模块加载机制 — 面试流程图

> 对应文件: `module-loader-demo.js` / `esm-loader-demo.js`

## 1. CommonJS 模块加载 (webpack 运行时的基石)

```mermaid
flowchart TD
    START["require('./src/name.js')"] --> CHECK{"cache 中<br/>是否已有该模块?"}

    CHECK -->|"命中缓存"| HIT["直接返回<br/>cache[modulePath].exports<br/>(不重复执行模块代码)"]

    CHECK -->|"未命中"| CREATE["创建 module 对象<br/>var module = cache[modulePath] = { exports: {} }<br/>-------<br/>关键: module 和 cache[modulePath]<br/>指向同一个引用地址"]

    CREATE --> EXEC["执行模块工厂函数<br/>modules[modulePath](module, module.exports, require)<br/>-------<br/>模块内部通过 module.exports = xxx 赋值"]

    EXEC --> RETURN["return module.exports<br/>-------<br/>因为是引用传递,<br/>module.exports 的改动已同步到 cache"]

    RETURN --> DONE["调用方拿到导出值"]
    HIT --> DONE

    style START fill:#4a90d9,color:#fff
    style CHECK fill:#f5a623,color:#fff
    style CREATE fill:#e8f4fd,stroke:#4a90d9
    style EXEC fill:#e8f4fd,stroke:#4a90d9
    style HIT fill:#d4edda,stroke:#28a745
    style DONE fill:#d4edda,stroke:#28a745
```

**面试要点:**
- `cache` 的作用: 1) 性能优化,避免重复执行 2) 解决循环依赖(A require B, B require A 时,B 拿到 A 的部分 exports)
- `module = cache[path] = {exports:{}}` 是关键 — 赋值表达式返回右侧值,所以 module 和 cache 里存的是同一个对象

## 2. ES Module 加载 (webpack 如何处理 import/export)

```mermaid
flowchart TD
    SOURCE["源码:<br/>export default author<br/>export const age = '18'"]

    SOURCE --> COMPILE["webpack 编译阶段<br/>将 ESM 语法转换为 CJS 风格"]

    COMPILE --> TAG["require.setModuleTag(exports)<br/>1. Symbol.toStringTag = 'Module'<br/>2. __esModule = true<br/>-------<br/>标识这是一个 ES Module"]

    TAG --> DEFINE["require.defineProperty(exports, {<br/>  age: () => age,<br/>  default: () => DEFAULT_EXPORT<br/>})<br/>-------<br/>用 Object.defineProperty 定义 getter<br/>实现 live binding (动态绑定)"]

    DEFINE --> USE_DEFAULT["import author from './name'<br/>→ 访问 exports['default']<br/>→ 触发 getter → 返回当前值"]

    DEFINE --> USE_NAMED["import { age } from './name'<br/>→ 访问 exports.age<br/>→ 触发 getter → 返回当前值"]

    subgraph LIVE_BINDING ["Live Binding 的意义"]
        LB1["源模块中 age 变量被修改"]
        LB2["消费方再次访问 exports.age"]
        LB3["getter 函数重新执行<br/>返回最新的 age 值"]
        LB1 --> LB2 --> LB3
    end

    style SOURCE fill:#4a90d9,color:#fff
    style TAG fill:#f5a623,color:#fff
    style DEFINE fill:#f5a623,color:#fff
    style LIVE_BINDING fill:#fff3cd,stroke:#ffc107
```

**面试要点:**
- ESM 和 CJS 的核心区别: ESM 是 **live binding**(getter 动态取值), CJS 是 **值拷贝**
- `__esModule` 标记用于区分 ESM 和 CJS 模块,影响 `import xxx from` 时取 `.default` 还是整个对象
- webpack 不管你写的是 ESM 还是 CJS,最终 bundle 里都是自己实现的 require 运行时

## 3. CJS vs ESM 对比速查

```mermaid
flowchart LR
    subgraph CJS ["CommonJS"]
        C1["module.exports = value"]
        C2["require('./xxx')"]
        C3["值拷贝 (快照)"]
        C4["运行时加载"]
        C5["可以条件 require"]
    end

    subgraph ESM ["ES Module"]
        E1["export default / export const"]
        E2["import xxx from './xxx'"]
        E3["live binding (引用)"]
        E4["编译时确定依赖"]
        E5["只能顶层 import"]
    end

    C3 ---|"核心区别"| E3

    style CJS fill:#e8f4fd,stroke:#4a90d9
    style ESM fill:#d4edda,stroke:#28a745
```
