/**
 * CI/CD Pipeline 编排 — 概念笔记（仅注释，不实现代码）
 *
 * ═══════════════════════════════════════════════════════
 *  CI/CD 是什么
 * ═══════════════════════════════════════════════════════
 *
 * CI（Continuous Integration）持续集成：
 *   代码提交 → 自动构建 + 测试 → 及早发现问题
 *
 * CD（Continuous Delivery/Deployment）持续交付/部署：
 *   CI 通过 → 自动发布到测试/生产环境
 *
 * ═══════════════════════════════════════════════════════
 *  Pipeline 编排核心
 * ═══════════════════════════════════════════════════════
 *
 * Pipeline = 一系列有依赖关系的 Job
 * 本质是一个 DAG（有向无环图）的调度问题
 *
 * GitHub Actions 示例：
 *
 *   jobs:
 *     lint:
 *       runs-on: ubuntu-latest
 *       steps:
 *         - uses: actions/checkout@v4
 *         - run: npm ci
 *         - run: npm run lint
 *
 *     test:
 *       needs: [lint]              # 依赖 lint job
 *       runs-on: ubuntu-latest
 *       steps:
 *         - run: npm test
 *
 *     build:
 *       needs: [lint]              # 只依赖 lint，和 test 并行
 *       runs-on: ubuntu-latest
 *       steps:
 *         - run: npm run build
 *
 *     deploy:
 *       needs: [test, build]       # 依赖 test 和 build 都完成
 *       runs-on: ubuntu-latest
 *       steps:
 *         - run: deploy.sh
 *
 * 执行顺序：
 *   lint → test  ↘
 *        → build → deploy
 *
 * ═══════════════════════════════════════════════════════
 *  DAG 调度算法
 * ═══════════════════════════════════════════════════════
 *
 * 1. 构建依赖图（DAG）
 *    节点 = Job，边 = needs 依赖关系
 *
 * 2. 拓扑排序 + 并行执行
 *    入度为 0 的 job → 立即执行（可并行）
 *    job 完成 → 依赖它的 job 入度 -1
 *    入度变为 0 → 加入执行队列
 *
 * 3. 失败处理
 *    job 失败 → 所有依赖它的 job 跳过（或根据 if: always() 决定）
 *    可配置：continue-on-error: true
 *
 * 4. 矩阵构建（Matrix Strategy）
 *    同一 job 用不同参数并行跑多次
 *    strategy:
 *      matrix:
 *        node-version: [16, 18, 20]
 *        os: [ubuntu, windows]
 *    → 6 个并行任务
 *
 * ═══════════════════════════════════════════════════════
 *  前端 CI/CD 常见流程
 * ═══════════════════════════════════════════════════════
 *
 * PR 触发：
 *   1. lint（ESLint + Prettier check）
 *   2. type-check（TypeScript 类型检查）
 *   3. unit-test（Jest / Vitest）
 *   4. build（确保能构建成功）
 *   5. preview deploy（部署预览环境，如 Vercel Preview）
 *
 * 合并到 main：
 *   1. build（生产构建）
 *   2. e2e-test（Playwright / Cypress）
 *   3. deploy-staging（部署到测试环境）
 *   4. smoke-test（生产冒烟测试）
 *   5. deploy-production（部署到生产）
 *
 * 优化策略：
 *   - 只跑受影响的测试（affected analysis）
 *   - 缓存 node_modules 和构建产物
 *   - 并行化无依赖的任务
 *   - 增量构建（Turborepo cache）
 *
 * ═══════════════════════════════════════════════════════
 *  面试要点
 * ═══════════════════════════════════════════════════════
 *
 * 1. CI/CD Pipeline = DAG 调度：Job 之间有依赖 → 拓扑排序 → 并行执行
 * 2. GitHub Actions：jobs + needs + steps，trigger 触发条件
 * 3. 前端 CI 核心：lint → type-check → test → build → deploy
 * 4. 优化：缓存(npm ci + build cache) + 并行 + affected analysis
 * 5. 矩阵构建：同一 job 多参数并行（多 Node 版本/多 OS）
 * 6. 失败策略：fail-fast(默认) / continue-on-error / if: always()
 * 7. CD 安全：环境变量加密 + 审批门控 + 灰度发布 + 回滚能力
 */

console.log("=== CI/CD Pipeline 编排 — 概念笔记 ===\n");
console.log("本文件只包含注释，不包含代码实现。\n");

const topics = [
  { name: "Pipeline", key: "DAG 有向无环图 → 拓扑排序 → 入度 0 并行执行" },
  { name: "GitHub Actions", key: "jobs(needs 依赖) + steps(runs-on 环境) + trigger(on 触发)" },
  { name: "前端 CI", key: "lint → type-check → test → build → deploy" },
  { name: "优化", key: "缓存 + 并行 + affected analysis + 增量构建" },
  { name: "矩阵构建", key: "matrix strategy: node×os → 并行多配置测试" },
];

topics.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.name}`);
  console.log(`     ${t.key}\n`);
});
