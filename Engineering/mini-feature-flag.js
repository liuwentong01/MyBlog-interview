/**
 * 灰度发布 / Feature Flag 实现
 *
 * ═══════════════════════════════════════════════════════
 *  Feature Flag 的核心原理
 * ═══════════════════════════════════════════════════════
 *
 * Feature Flag（特性开关）= 运行时控制代码行为的配置
 *
 * 用途：
 *   1. 灰度发布：新功能只对 10% 用户开放 → 逐步放量 → 全量
 *   2. A/B 测试：不同用户看到不同版本 → 数据驱动决策
 *   3. 紧急回滚：线上出 bug → 关闭开关 → 秒级回滚（无需重新部署）
 *   4. 功能隐藏：代码已上线但功能未开放（trunk-based development）
 *
 * 核心流程：
 *   1. 定义 Flag（name + type + rules）
 *   2. 用户请求时，SDK 根据 rules 判断该用户命中哪个分桶
 *   3. 返回对应的 Flag 值（true/false 或具体配置）
 *
 * 分桶策略：
 *   - 百分比：userId hash → 0~99 → 命中区间 [0, percentage)
 *   - 白名单：userId 在列表中
 *   - 规则匹配：用户属性（地区、版本、设备）满足条件
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. Feature Flag 配置系统
 *  2. 分桶算法（hash 取模 + 白名单 + 规则匹配）
 *  3. SDK 客户端（evaluate + cache）
 *  4. 灰度发布流程模拟
 *  5. A/B 测试模拟
 *
 * 运行方式：node Engineering/mini-feature-flag.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、Hash 函数
// ═══════════════════════════════════════════════════════════════════════════
//
// 灰度分桶的关键：对用户 ID 做 hash → 取模得到 0~99 的值
// 要求：
//   1. 同一用户每次得到的值相同（确定性）
//   2. 不同用户均匀分布（低碰撞率）
//   3. 简单快速（运行时高频调用）
//
// 常用：MurmurHash / FNV / CityHash
// 这里用简化版 FNV-1a

function hashString(str) {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, 保持 32 位无符号
  }
  return hash;
}

/**
 * 将用户 ID + flag name hash 到 [0, 100) 范围
 * 加入 flag name 确保同一用户在不同 flag 中分到不同桶
 */
function getBucket(userId, flagName) {
  const key = `${flagName}:${userId}`;
  return hashString(key) % 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、Feature Flag 配置
// ═══════════════════════════════════════════════════════════════════════════
//
// Flag 配置结构：
//   {
//     name: "new-checkout",
//     enabled: true,          // 全局开关
//     type: "boolean",        // boolean | string | json
//     rules: [                // 从上到下匹配，命中第一个就返回
//       { type: "whitelist", userIds: [...], value: true },
//       { type: "percentage", percentage: 30, value: true },
//       { type: "attribute", key: "country", operator: "in", values: ["CN"], value: true },
//     ],
//     defaultValue: false,    // 所有规则都不命中时的默认值
//   }

class FlagConfig {
  constructor(flags = []) {
    this.flags = new Map();
    for (const flag of flags) {
      this.flags.set(flag.name, flag);
    }
  }

  getFlag(name) {
    return this.flags.get(name);
  }

  setFlag(flag) {
    this.flags.set(flag.name, flag);
  }

  // 修改灰度比例（灰度放量的核心操作）
  setPercentage(flagName, percentage) {
    const flag = this.flags.get(flagName);
    if (!flag) return;
    const rule = flag.rules.find((r) => r.type === "percentage");
    if (rule) {
      rule.percentage = percentage;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、Feature Flag SDK
// ═══════════════════════════════════════════════════════════════════════════
//
// SDK 的职责：
//   1. 接收用户上下文（userId, attributes）
//   2. 根据配置的规则 evaluate 每个 flag
//   3. 返回该用户看到的 flag 值
//   4. 缓存结果（避免重复计算）

class FeatureFlagSDK {
  constructor(config) {
    this.config = config;
    this.cache = new Map(); // `${userId}:${flagName}` → value
    this.evaluationLog = []; // 记录每次评估（用于调试/分析）
  }

  /**
   * 评估一个 flag 对指定用户的值
   * @param {string} flagName
   * @param {Object} context - { userId, attributes: { country, version, ... } }
   * @returns {*} flag 的值
   */
  evaluate(flagName, context) {
    const { userId, attributes = {} } = context;
    const cacheKey = `${userId}:${flagName}`;

    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const flag = this.config.getFlag(flagName);

    // flag 不存在或全局关闭
    if (!flag || !flag.enabled) {
      return flag ? flag.defaultValue : undefined;
    }

    // 按顺序匹配规则
    for (const rule of flag.rules) {
      const result = this._evaluateRule(rule, userId, attributes, flagName);
      if (result.matched) {
        this.cache.set(cacheKey, result.value);
        this.evaluationLog.push({
          userId, flagName, rule: rule.type, value: result.value,
        });
        return result.value;
      }
    }

    // 所有规则都不命中，返回默认值
    this.cache.set(cacheKey, flag.defaultValue);
    return flag.defaultValue;
  }

  _evaluateRule(rule, userId, attributes, flagName) {
    switch (rule.type) {
      case "whitelist":
        // 白名单：userId 在列表中
        if (rule.userIds.includes(userId)) {
          return { matched: true, value: rule.value };
        }
        return { matched: false };

      case "blacklist":
        // 黑名单：userId 在列表中 → 不命中（跳过此规则）
        if (rule.userIds.includes(userId)) {
          return { matched: true, value: rule.value };
        }
        return { matched: false };

      case "percentage":
        // 百分比：hash(userId + flagName) % 100 < percentage
        const bucket = getBucket(userId, flagName);
        if (bucket < rule.percentage) {
          return { matched: true, value: rule.value };
        }
        return { matched: false };

      case "attribute":
        // 属性匹配：用户属性满足条件
        const attrValue = attributes[rule.key];
        let matched = false;
        switch (rule.operator) {
          case "eq": matched = attrValue === rule.values[0]; break;
          case "neq": matched = attrValue !== rule.values[0]; break;
          case "in": matched = rule.values.includes(attrValue); break;
          case "not_in": matched = !rule.values.includes(attrValue); break;
          case "gt": matched = attrValue > rule.values[0]; break;
          case "lt": matched = attrValue < rule.values[0]; break;
        }
        if (matched) {
          return { matched: true, value: rule.value };
        }
        return { matched: false };

      default:
        return { matched: false };
    }
  }

  // 清除缓存（配置更新后需要）
  clearCache() {
    this.cache.clear();
  }

  // 批量评估所有 flag
  evaluateAll(context) {
    const result = {};
    for (const [name] of this.config.flags) {
      result[name] = this.evaluate(name, context);
    }
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== 灰度发布 / Feature Flag 演示 ===\n");

// ── 定义 Flag 配置 ──

const config = new FlagConfig([
  {
    name: "new-checkout",
    enabled: true,
    type: "boolean",
    rules: [
      // 规则 1：内部员工白名单 → 始终开启
      { type: "whitelist", userIds: ["admin", "dev-001", "qa-001"], value: true },
      // 规则 2：30% 灰度
      { type: "percentage", percentage: 30, value: true },
    ],
    defaultValue: false,
  },
  {
    name: "dark-mode",
    enabled: true,
    type: "boolean",
    rules: [
      // 只对中国地区开放
      { type: "attribute", key: "country", operator: "in", values: ["CN", "TW", "HK"], value: true },
    ],
    defaultValue: false,
  },
  {
    name: "search-algorithm",
    enabled: true,
    type: "string",
    rules: [
      // A/B 测试：50% 用户用 v2，50% 用 v1
      { type: "percentage", percentage: 50, value: "v2" },
    ],
    defaultValue: "v1",
  },
  {
    name: "disabled-feature",
    enabled: false, // 全局关闭
    type: "boolean",
    rules: [{ type: "percentage", percentage: 100, value: true }],
    defaultValue: false,
  },
]);

const sdk = new FeatureFlagSDK(config);

// ── 测试 1：白名单 ──

console.log("【测试 1】白名单规则\n");

const whitelistUsers = ["admin", "dev-001", "user-123", "user-456"];
whitelistUsers.forEach((userId) => {
  const value = sdk.evaluate("new-checkout", { userId });
  console.log(`  userId=${userId.padEnd(10)} → new-checkout: ${value}`);
});

// ── 测试 2：百分比灰度 ──

console.log("\n\n【测试 2】百分比灰度（30%）\n");

let hitCount = 0;
const totalUsers = 1000;

for (let i = 0; i < totalUsers; i++) {
  const userId = `user-${i}`;
  sdk.cache.delete(`${userId}:new-checkout`); // 清除缓存以重新评估
  if (sdk.evaluate("new-checkout", { userId })) {
    hitCount++;
  }
}

console.log(`  ${totalUsers} 个用户中 ${hitCount} 个命中 (${((hitCount / totalUsers) * 100).toFixed(1)}%)`);
console.log("  配置的灰度比例: 30%");
console.log("  (包含 3 个白名单用户，所以略高于 30%)");

// ── 测试 3：属性匹配 ──

console.log("\n\n【测试 3】属性匹配规则\n");

const users = [
  { userId: "cn-user", attributes: { country: "CN" } },
  { userId: "us-user", attributes: { country: "US" } },
  { userId: "tw-user", attributes: { country: "TW" } },
  { userId: "jp-user", attributes: { country: "JP" } },
];

users.forEach(({ userId, attributes }) => {
  const value = sdk.evaluate("dark-mode", { userId, attributes });
  console.log(`  userId=${userId.padEnd(10)} country=${attributes.country} → dark-mode: ${value}`);
});

// ── 测试 4：A/B 测试 ──

console.log("\n\n【测试 4】A/B 测试\n");

const groups = { v1: 0, v2: 0 };
for (let i = 0; i < 1000; i++) {
  const userId = `ab-user-${i}`;
  const version = sdk.evaluate("search-algorithm", { userId });
  groups[version]++;
}

console.log("  search-algorithm A/B 分布 (1000 用户):");
console.log(`    v1: ${groups.v1} (${((groups.v1 / 1000) * 100).toFixed(1)}%)`);
console.log(`    v2: ${groups.v2} (${((groups.v2 / 1000) * 100).toFixed(1)}%)`);

// ── 测试 5：全局关闭 ──

console.log("\n\n【测试 5】全局开关\n");

const disabledResult = sdk.evaluate("disabled-feature", { userId: "anyone" });
console.log(`  disabled-feature (enabled=false): ${disabledResult}`);
console.log("  (全局关闭后，即使配置了 100% 灰度也返回 defaultValue)");

// ── 测试 6：灰度放量过程 ──

console.log("\n\n【测试 6】灰度放量过程模拟\n");

const stages = [5, 10, 30, 50, 80, 100];
stages.forEach((pct) => {
  config.setPercentage("new-checkout", pct);
  sdk.clearCache();

  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    if (sdk.evaluate("new-checkout", { userId: `user-${i}` })) hits++;
  }
  const bar = "█".repeat(Math.round(hits / 1000 * 30));
  console.log(`  ${String(pct).padStart(3)}% → ${String(hits).padStart(4)}/1000 命中 ${bar}`);
});

// ── 测试 7：hash 分桶一致性 ──

console.log("\n\n【测试 7】Hash 分桶一致性验证\n");

const testUser = "consistent-user";
const bucket1 = getBucket(testUser, "flag-a");
const bucket2 = getBucket(testUser, "flag-a");
const bucket3 = getBucket(testUser, "flag-b");

console.log(`  同一用户同一 flag → 相同桶号: ${bucket1} === ${bucket2} → ${bucket1 === bucket2}`);
console.log(`  同一用户不同 flag → 不同桶号: ${bucket1} vs ${bucket3} → 独立分桶`);

// ── 测试 8：批量评估 ──

console.log("\n\n【测试 8】批量评估所有 Flag\n");

config.setPercentage("new-checkout", 30); // 恢复
sdk.clearCache();

const allFlags = sdk.evaluateAll({
  userId: "cn-user",
  attributes: { country: "CN" },
});

console.log("  cn-user 的所有 Flag 值:");
Object.entries(allFlags).forEach(([name, value]) => {
  console.log(`    ${name.padEnd(20)} = ${value}`);
});

console.log("\n\n=== 面试要点 ===");
console.log("1. Feature Flag = 运行时代码开关，支持灰度发布/A/B测试/紧急回滚");
console.log("2. 分桶算法：hash(userId + flagName) % 100 → 确定性 + 均匀分布");
console.log("3. 规则优先级：白名单 > 百分比 > 属性匹配 > defaultValue（从上到下匹配）");
console.log("4. 灰度放量：修改百分比配置 5% → 10% → 30% → 100%，观察指标");
console.log("5. 加入 flagName 到 hash key，确保同一用户在不同 flag 中独立分桶");
console.log("6. 客户端 SDK 需要缓存 + 配置更新机制（轮询/推送）");
console.log("7. 安全：flag 配置不要放客户端，由后端 evaluate → 返回结果");
