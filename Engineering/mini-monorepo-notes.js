/**
 * Monorepo 工具核心 — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  Monorepo 是什么
 * ═══════════════════════════════════════════════════════
 *
 * Monorepo = 一个 Git 仓库中管理多个相关包/项目
 *
 * vs Multirepo（每个包独立仓库）：
 *   Multirepo：代码隔离、独立发布，但跨包改动困难、依赖管理复杂
 *   Monorepo：代码共享、原子提交，但仓库大、CI 慢（需要工具优化）
 *
 * 典型项目：React、Vue、Babel、Next.js 都是 Monorepo
 *
 * ═══════════════════════════════════════════════════════
 *  核心工具链
 * ═══════════════════════════════════════════════════════
 *
 * 【包管理：Workspace】
 *
 *   npm/yarn/pnpm 都支持 workspace：
 *
 *   // package.json (根目录)
 *   { "workspaces": ["packages/*"] }
 *
 *   // pnpm-workspace.yaml
 *   packages:
 *     - 'packages/*'
 *     - 'apps/*'
 *
 *   workspace 做了什么？
 *   1. 将所有包的依赖统一安装（共享 node_modules）
 *   2. 内部包之间的引用自动软链接（不需要发布到 npm）
 *      packages/A 的 dependencies: { "B": "workspace:*" }
 *      → A 的 node_modules/B → 直接链接到 packages/B
 *   3. 统一的版本管理和脚本执行
 *
 * 【任务编排：Turborepo / Nx / Lerna】
 *
 *   Turborepo 核心：
 *   1. 任务依赖图（Task Graph）
 *      "build" 依赖 "lint" → 拓扑排序 → 确定执行顺序
 *      packages/B 依赖 packages/A → A 的 build 先执行
 *
 *   2. 并行执行
 *      无依赖的任务并行跑（如 A 和 C 互不依赖 → 同时 build）
 *
 *   3. 缓存
 *      hash(源文件 + 依赖 + 环境变量) → 缓存 key
 *      输入没变 → 直接用缓存输出（跳过执行）
 *      Remote Cache → 团队共享缓存（CI A 构建过 → CI B 直接用）
 *
 *   // turbo.json
 *   {
 *     "pipeline": {
 *       "build": {
 *         "dependsOn": ["^build"],  // 先构建依赖的包
 *         "outputs": ["dist/**"]     // 缓存的输出
 *       },
 *       "lint": {},                   // 无依赖，可并行
 *       "test": {
 *         "dependsOn": ["build"]      // 先 build 再 test
 *       }
 *     }
 *   }
 *
 * 【版本管理：Changesets】
 *
 *   1. 开发者提交 changeset（描述改了什么 + 版本变更级别）
 *      npx changeset → 选择包 → 选择 major/minor/patch → 写描述
 *
 *   2. 发布时：changeset 自动更新版本号 + CHANGELOG
 *      npx changeset version → 根据 changeset 更新所有包的版本
 *      npx changeset publish → 发布到 npm
 *
 *   3. 自动处理关联包的版本更新
 *      A 依赖 B → B 发了 minor → A 也需要更新依赖版本
 *
 * ═══════════════════════════════════════════════════════
 *  拓扑排序 — 任务编排的核心算法
 * ═══════════════════════════════════════════════════════
 *
 * 包之间的依赖关系是一个 DAG（有向无环图）：
 *
 *   A → B → D
 *   A → C → D
 *
 * 拓扑排序结果：D → B → C → A（先构建没有依赖的包）
 *
 * 算法（Kahn's）：
 *   1. 计算每个节点的入度（被依赖数）
 *   2. 入度为 0 的节点入队（没有依赖，可以先执行）
 *   3. 出队一个节点 → 执行 → 将其依赖者的入度 -1
 *   4. 入度变为 0 的节点入队
 *   5. 重复直到队列空
 *   6. 如果还有未处理的节点 → 有环（错误）
 *
 * ═══════════════════════════════════════════════════════
 *  常见 Monorepo 方案对比
 * ═══════════════════════════════════════════════════════
 *
 *   工具          包管理      任务编排     缓存        语言
 *   ─────────────────────────────────────────────────
 *   Lerna        npm/yarn    串行/并行   本地        JS
 *   Turborepo    任意        拓扑排序    本地+远程   Go
 *   Nx           任意        依赖图     本地+远程   TS
 *   pnpm         pnpm        workspace  无          Rust
 *   Rush         pnpm        自带       自带        TS
 *
 *   推荐组合：pnpm workspace + Turborepo + Changesets
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. Monorepo 核心优势：代码共享、原子提交、统一工具链
 * 2. Workspace：统一安装依赖 + 内部包自动软链接（workspace:* 协议）
 * 3. 任务编排：拓扑排序确定执行顺序 + 无依赖任务并行
 * 4. 缓存：hash(输入) → 缓存 key，输入不变 → 跳过执行（Remote Cache 跨 CI 共享）
 * 5. 拓扑排序算法：Kahn's（计算入度 → 入度 0 入队 → 出队执行 → 更新入度）
 * 6. pnpm + Turborepo + Changesets 是当前主流 Monorepo 方案
 * 7. 挑战：仓库体积大、CI 慢 → 需要增量构建 + 缓存 + affected 分析
 */

console.log("=== Monorepo 工具核心 — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "Workspace", key: "统一安装 + 内部包软链接（workspace:* 协议）" },
  { name: "任务编排", key: "DAG 拓扑排序 → 确定构建顺序 + 并行执行无依赖任务" },
  { name: "缓存", key: "hash(源码+依赖+环境) → 缓存 key → 跳过不必要的构建" },
  { name: "Remote Cache", key: "CI 间共享缓存 → 一个人构建过的，其他人直接用" },
  { name: "Changesets", key: "changeset 描述变更 → 自动更新版本号 + CHANGELOG → 发布" },
  { name: "推荐方案", key: "pnpm workspace + Turborepo + Changesets" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
