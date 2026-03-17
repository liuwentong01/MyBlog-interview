/**
 * npm install 原理 — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  npm install 做了什么？
 * ═══════════════════════════════════════════════════════
 *
 * 执行 npm install 的完整流程：
 *
 *   1. 解析依赖树
 *      读取 package.json 的 dependencies/devDependencies
 *      递归解析每个包的 package.json → 构建完整依赖树
 *      处理版本范围（semver）→ 确定具体版本
 *
 *   2. 查询注册表
 *      npm registry（https://registry.npmjs.org/）
 *      获取包的所有版本信息 → 选择满足 semver 的最新版本
 *      检查缓存（~/.npm/_cacache）→ 有则跳过下载
 *
 *   3. 下载 tarball
 *      下载 .tgz 压缩包 → 解压到 node_modules/
 *      并行下载（npm v7+ 默认并行）
 *
 *   4. 构建 node_modules 结构
 *      扁平化（hoisting）→ 尽量提升到顶层
 *      处理版本冲突 → 无法提升的嵌套安装
 *
 *   5. 生成 lock 文件
 *      package-lock.json → 锁定确切版本和下载地址
 *      确保团队成员安装完全相同的依赖
 *
 *   6. 执行 lifecycle scripts
 *      preinstall → install → postinstall
 *      如 node-gyp 编译原生模块
 *
 * ═══════════════════════════════════════════════════════
 *  Semver 版本范围匹配
 * ═══════════════════════════════════════════════════════
 *
 * 语义化版本：MAJOR.MINOR.PATCH
 *   MAJOR：不兼容的 API 变更
 *   MINOR：向下兼容的新功能
 *   PATCH：向下兼容的 Bug 修复
 *
 * 版本范围语法：
 *   ^1.2.3 → >=1.2.3 <2.0.0  (允许 minor + patch 升级，最常用)
 *   ~1.2.3 → >=1.2.3 <1.3.0  (只允许 patch 升级)
 *   1.2.3  → 精确版本
 *   >=1.0.0 <2.0.0 → 范围
 *   * → 任意版本
 *
 * 特殊情况：
 *   ^0.2.3 → >=0.2.3 <0.3.0  (0.x 版本 minor 也视为 breaking)
 *   ^0.0.3 → 精确 0.0.3      (0.0.x 更保守)
 *
 * ═══════════════════════════════════════════════════════
 *  node_modules 结构演化
 * ═══════════════════════════════════════════════════════
 *
 * 【npm v2：嵌套结构】
 *   node_modules/
 *     A/
 *       node_modules/
 *         B@1.0/
 *     C/
 *       node_modules/
 *         B@2.0/
 *
 *   问题：路径极深 + 大量重复安装（Windows 260 字符路径限制）
 *
 * 【npm v3+：扁平化（hoisting）】
 *   node_modules/
 *     A/
 *     B@1.0/      ← A 的依赖被提升到顶层
 *     C/
 *       node_modules/
 *         B@2.0/  ← C 需要 B@2.0，和顶层 B@1.0 冲突，嵌套安装
 *
 *   好处：减少重复，路径短
 *   问题：幽灵依赖（未声明的包也能 import）
 *
 * 【pnpm：内容寻址 + 符号链接】
 *   .pnpm/
 *     A@1.0/node_modules/A/
 *     B@1.0/node_modules/B/
 *     B@2.0/node_modules/B/
 *   node_modules/
 *     A → .pnpm/A@1.0/node_modules/A  (符号链接)
 *     .pnpm/                            (实际文件)
 *
 *   全局 store (~/.pnpm-store) → 硬链接到项目 → 磁盘共享
 *   严格依赖：只能 import 声明过的包（解决幽灵依赖）
 *
 * ═══════════════════════════════════════════════════════
 *  Lock 文件
 * ═══════════════════════════════════════════════════════
 *
 * package-lock.json（npm）/ yarn.lock / pnpm-lock.yaml
 *
 * 记录内容：
 *   - 每个包的精确版本
 *   - 下载地址（resolved）
 *   - 完整性校验（integrity: sha512-xxx）
 *   - 依赖关系
 *
 * 作用：
 *   - 确保 CI 和团队成员安装完全相同的依赖
 *   - 加速安装（直接用确定版本，跳过解析）
 *   - 安全（integrity 校验防止供应链攻击）
 *
 * 应该提交到 git：是的，lock 文件必须提交！
 *
 * ═══════════════════════════════════════════════════════
 *  peerDependencies
 * ═══════════════════════════════════════════════════════
 *
 * 用途：声明"我需要宿主环境提供这个包"
 *
 *   // react-select 的 package.json
 *   { "peerDependencies": { "react": ">=16.8" } }
 *
 * 含义：
 *   "我不会自己安装 react，但我需要你的项目里有 react >=16.8"
 *   避免同一个包被安装多次（如 React 只能有一个实例）
 *
 * npm v7+：自动安装 peerDependencies
 * npm v3-6：只给警告，不安装
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. npm install = 解析依赖树 → 查注册表 → 下载 → 扁平化安装 → 生成 lock
 * 2. semver: ^允许 minor+patch 升级，~只允许 patch 升级
 * 3. 扁平化（hoisting）解决深层嵌套，但引入幽灵依赖问题
 * 4. pnpm 用内容寻址 + 符号链接 + 硬链接：严格依赖 + 磁盘共享
 * 5. lock 文件锁定精确版本 + integrity 校验 → 必须提交到 git
 * 6. peerDependencies 避免核心库重复安装（如 React）
 * 7. 幽灵依赖：未在 package.json 声明但能 import 的包（扁平化副作用）
 */

console.log("=== npm install 原理 — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "安装流程", key: "解析依赖树 → 查注册表 → 下载 tarball → 扁平化安装 → 生成 lock" },
  { name: "Semver", key: "^允许 minor+patch, ~只允许 patch, 0.x 版本更保守" },
  { name: "node_modules 结构", key: "v2 嵌套 → v3+ 扁平化(hoisting) → pnpm 符号链接+硬链接" },
  { name: "Lock 文件", key: "精确版本 + integrity 校验 + 必须提交 git" },
  { name: "peerDependencies", key: "宿主环境提供（避免重复安装），npm v7+ 自动安装" },
  { name: "幽灵依赖", key: "扁平化副作用：未声明的包也能 import → pnpm 严格模式解决" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
