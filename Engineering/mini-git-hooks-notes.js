/**
 * Git Hooks + Lint-staged — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  Git Hooks 是什么
 * ═══════════════════════════════════════════════════════
 *
 * Git Hooks = Git 在特定操作前/后自动执行的脚本
 * 位置：.git/hooks/ 目录下的可执行文件
 *
 * 常用 Hooks：
 *   pre-commit     — commit 前执行（跑 lint/format/test）
 *   commit-msg     — 检查 commit message 格式
 *   pre-push       — push 前执行（跑完整测试）
 *   post-merge     — merge 后执行（自动 npm install）
 *   pre-rebase     — rebase 前执行
 *
 * 退出码：
 *   exit 0 → 允许操作继续
 *   exit 非0 → 阻止操作（如 pre-commit 失败 → commit 被中止）
 *
 * ═══════════════════════════════════════════════════════
 *  Husky — Git Hooks 管理工具
 * ═══════════════════════════════════════════════════════
 *
 * 问题：.git/hooks 不能提交到 Git（.git 目录不被跟踪）
 * Husky 解决方案：
 *
 * 旧方案（v4）：
 *   修改 .git/hooks → 指向项目中的脚本
 *   问题：需要 postinstall hook 自动设置
 *
 * 新方案（v9+）：
 *   .husky/ 目录下放 hook 脚本（可提交到 Git）
 *   安装时 husky init → 设置 core.hooksPath = .husky
 *
 *   // .husky/pre-commit
 *   npx lint-staged
 *
 *   // .husky/commit-msg
 *   npx commitlint --edit $1
 *
 * ═══════════════════════════════════════════════════════
 *  Lint-staged — 只检查暂存文件
 * ═══════════════════════════════════════════════════════
 *
 * 问题：全量跑 eslint → 太慢（大项目 10000+ 文件）
 * 解决：只对 git add 暂存的文件跑 lint
 *
 * 原理：
 *   1. git diff --cached --name-only → 获取暂存文件列表
 *   2. 按 glob 匹配规则过滤文件
 *   3. 对匹配的文件执行配置的命令
 *   4. 如果有文件被修改（如 prettier 自动格式化）→ 重新 git add
 *
 *   // package.json 或 .lintstagedrc
 *   {
 *     "lint-staged": {
 *       "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
 *       "*.css": ["stylelint --fix"],
 *       "*.md": ["prettier --write"]
 *     }
 *   }
 *
 * 流程：
 *   git commit → pre-commit hook → lint-staged
 *   → git diff --cached（暂存文件）
 *   → 匹配 *.js → eslint --fix → prettier --write
 *   → 如果修复了 → git add（重新暂存）
 *   → 全部通过 → exit 0 → commit 成功
 *   → 有错误 → exit 1 → commit 中止
 *
 * ═══════════════════════════════════════════════════════
 *  Commitlint — commit message 规范
 * ═══════════════════════════════════════════════════════
 *
 * Conventional Commits 规范：
 *   <type>(<scope>): <description>
 *
 *   type: feat / fix / docs / style / refactor / test / chore
 *   scope: 可选，影响范围
 *   description: 简短描述
 *
 *   示例：
 *   feat(auth): add Google OAuth login
 *   fix(cart): correct price calculation
 *
 * Commitlint 在 commit-msg hook 中检查：
 *   1. 读取 .git/COMMIT_EDITMSG 中的 message
 *   2. 解析 type/scope/description
 *   3. 校验是否符合规范
 *   4. 不符合 → exit 1 → commit 中止
 *
 * 好处：
 *   - 统一团队提交风格
 *   - 自动生成 CHANGELOG（conventional-changelog）
 *   - 自动确定版本号（feat → minor, fix → patch, BREAKING → major）
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. Git Hooks = .git/hooks/ 下的脚本，exit 0 放行，exit 非0 阻止
 * 2. Husky 将 hooks 放在 .husky/ 目录 → 可提交 Git → 团队共享
 * 3. Lint-staged 只对 git add 的暂存文件跑 lint → 性能好 + 增量检查
 * 4. 核心命令：git diff --cached --name-only → 获取暂存文件列表
 * 5. Commitlint 检查 commit message 格式 → 统一风格 + 自动 CHANGELOG
 * 6. 完整链路：git commit → husky(pre-commit) → lint-staged → eslint+prettier
 * 7. 不要用 --no-verify 跳过 hooks（应该修复问题而非绕过检查）
 */

console.log("=== Git Hooks + Lint-staged — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "Git Hooks", key: ".git/hooks/ 下的脚本，exit 0 放行，非0 阻止" },
  { name: "Husky", key: ".husky/ 目录可提交 Git → core.hooksPath → 团队共享" },
  { name: "Lint-staged", key: "git diff --cached → 只对暂存文件跑 lint → 快速增量检查" },
  { name: "Commitlint", key: "type(scope): desc 格式检查 → 统一风格 + 自动 CHANGELOG" },
  { name: "完整链路", key: "git commit → husky → lint-staged → eslint/prettier → commit-msg → commitlint" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
