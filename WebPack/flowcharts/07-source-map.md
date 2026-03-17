# Source Map — 面试流程图

> 对应文件: `source-map-demo.js`

## 1. Source Map 是什么?

```mermaid
flowchart LR
    BUNDLE["打包后的 bundle.js<br/>第 15 行报错"]
    BUNDLE -->|"sourceMappingURL"| MAP[".map 文件<br/>位置映射表"]
    MAP -->|"映射还原"| SOURCE["原始 greeting.js<br/>第 2 行, 第 10 列"]

    style BUNDLE fill:#f8d7da,stroke:#dc3545
    style MAP fill:#f5a623,color:#fff
    style SOURCE fill:#d4edda,stroke:#28a745
```

## 2. .map 文件结构

```mermaid
flowchart TD
    MAP_FILE[".map 文件 (JSON 格式)"]

    MAP_FILE --> V["version: 3<br/>固定为 3 (当前规范)"]
    MAP_FILE --> F["file: 'bundle.js'<br/>对应的产物文件名"]
    MAP_FILE --> S["sources: ['greeting.js', 'index.js']<br/>源文件列表"]
    MAP_FILE --> SC["sourcesContent: ['原始代码...']<br/>内嵌源码 (可选)"]
    MAP_FILE --> N["names: ['greeting', 'name']<br/>标识符列表 (压缩重命名时用)"]
    MAP_FILE --> M["mappings: 'AAAA,SAAS;AACT,...'<br/>核心: VLQ 编码的位置映射"]

    style MAP_FILE fill:#4a90d9,color:#fff
    style M fill:#f5a623,color:#fff
```

## 3. mappings 编码规则

```mermaid
flowchart TD
    MAPPINGS["mappings 字符串"]

    MAPPINGS --> LINES["用 ; 分隔<br/>每个 ; 代表产物的一行"]

    LINES --> SEGS["同一行内用 , 分隔<br/>每个 segment 是一个映射点"]

    SEGS --> FIELDS["每个 segment 包含 4-5 个字段<br/>(VLQ 编码)"]

    FIELDS --> F0["字段 0: 产物列号偏移"]
    FIELDS --> F1["字段 1: 源文件索引偏移<br/>(sources 数组中的下标)"]
    FIELDS --> F2["字段 2: 源码行号偏移"]
    FIELDS --> F3["字段 3: 源码列号偏移"]
    FIELDS --> F4["字段 4: names 索引偏移 (可选)"]

    FIELDS --> WHY["为什么用偏移量?<br/>偏移量通常很小 (0 或个位数)<br/>VLQ 编码后只需 1-2 个字符<br/>绝对值可能几百几千, 编码很长"]

    style MAPPINGS fill:#4a90d9,color:#fff
    style FIELDS fill:#f5a623,color:#fff
    style WHY fill:#fff3cd,stroke:#ffc107
```

## 4. VLQ Base64 编码过程

```mermaid
flowchart TD
    NUM["要编码的数字: 12"]

    NUM --> SIGN["1. 符号处理<br/>12 是正数 → 左移1位, 最低位设为0<br/>12 → 11000 (二进制)"]

    SIGN --> GROUP["2. 每 5 位一组 (低位在前)<br/>11000 → 只有一组: 11000 = 24"]

    GROUP --> CONT["3. 检查续延位<br/>没有更多位 → 第 6 位设为 0<br/>011000 = 24"]

    CONT --> BASE64["4. 映射到 Base64<br/>BASE64_CHARS[24] = 'Y'"]

    BASE64 --> RESULT["结果: 12 → 'Y'"]

    subgraph EXAMPLES ["更多示例"]
        E1["0 → 'A'  (A=0)"]
        E2["1 → 'C'  (C=2, 即 1<<1)"]
        E3["-1 → 'D' (D=3, 即 (1<<1)|1)"]
        E4["5 → 'K'  (K=10)"]
    end

    style NUM fill:#4a90d9,color:#fff
    style RESULT fill:#d4edda,stroke:#28a745
```

## 5. webpack devtool 选项速查

```mermaid
flowchart TD
    DEVTOOL["devtool 配置选项"]

    DEVTOOL --> SM["'source-map'<br/>完整 .map 文件, 精确到列<br/>构建最慢, 映射最精确<br/>适合: 生产环境调试"]

    DEVTOOL --> CSM["'cheap-source-map'<br/>只映射到行, 不映射列<br/>构建较快, .map 文件小<br/>适合: 行级别调试够用时"]

    DEVTOOL --> ESM["'eval-source-map'<br/>map 内嵌在 eval() 中<br/>增量构建最快<br/>适合: 开发环境"]

    DEVTOOL --> CMSM["'cheap-module-source-map'<br/>映射到 loader 处理前的源码<br/>适合: 有 TS/Babel 转换的项目"]

    DEVTOOL --> HSM["'hidden-source-map'<br/>生成 .map 但不加 URL 注释<br/>适合: 上传到 Sentry 等监控平台"]

    SM --- SLOW["构建速度: 慢 ←→ 快"]
    ESM --- FAST[""]

    style DEVTOOL fill:#4a90d9,color:#fff
    style ESM fill:#d4edda,stroke:#28a745
    style SM fill:#f8d7da,stroke:#dc3545
```

**面试要点:**
- Source Map 是 JSON 文件, 记录 "产物位置 → 源码位置" 的映射
- `mappings` 字段用 VLQ Base64 编码, 所有数值都是相对偏移量 (体积更小)
- VLQ 编码: 符号移到最低位 → 每 5 位一组 → 续延位标记 → 映射 Base64
- 开发用 `eval-source-map` (快), 生产用 `source-map` 或 `hidden-source-map`
