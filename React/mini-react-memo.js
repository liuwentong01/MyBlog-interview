/**
 * React.memo / shouldComponentUpdate / 浅比较 实现
 *
 * ═══════════════════════════════════════════════════════
 *  React 的重渲染机制
 * ═══════════════════════════════════════════════════════
 *
 * 默认行为：父组件重渲染 → 所有子组件都重渲染（不管 props 变没变）
 *
 * 优化手段：
 *   - Class 组件：shouldComponentUpdate(nextProps, nextState) 返回 false 跳过
 *   - Class 组件：PureComponent（自动浅比较 props + state）
 *   - 函数组件：React.memo（自动浅比较 props）
 *   - 自定义比较：React.memo(Component, areEqual)
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. shallowEqual     — 浅比较（React.memo / PureComponent 的核心）
 *  2. memo             — React.memo 实现
 *  3. PureComponent    — 自动浅比较的 Class 组件
 *  4. 演示 memo + useCallback 配合使用
 *
 * 运行方式：node React/mini-react-memo.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、shallowEqual（浅比较）
// ═══════════════════════════════════════════════════════════════════════════
//
// React 所有的"自动比较"都是浅比较，规则：
//   1. Object.is(a, b) 相等 → true（处理 NaN、+0/-0 等边界情况）
//   2. 任一方不是对象 → false
//   3. key 数量不同 → false
//   4. 逐个 key 用 Object.is 比较值 → 有一个不等就 false
//
// 关键：只比较第一层属性！
//   { a: 1, b: { x: 1 } } vs { a: 1, b: { x: 1 } }
//   → false！因为 b 指向不同的对象引用
//
// 这就是为什么：
//   - 不能在 render 中创建新对象/数组作为 props（每次都是新引用）
//   - 需要 useMemo/useCallback 来稳定引用

function shallowEqual(objA, objB) {
  // 完全相同（包括 NaN === NaN）
  if (Object.is(objA, objB)) return true;

  // 任一方不是对象（null、undefined、基本类型）
  if (
    typeof objA !== "object" || objA === null ||
    typeof objB !== "object" || objB === null
  ) {
    return false;
  }

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  // key 数量不同
  if (keysA.length !== keysB.length) return false;

  // 逐个比较
  for (const key of keysA) {
    if (
      !Object.prototype.hasOwnProperty.call(objB, key) ||
      !Object.is(objA[key], objB[key])
    ) {
      return false;
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、React.memo
// ═══════════════════════════════════════════════════════════════════════════
//
// React.memo(Component, areEqual?)
//
// 原理：
//   1. 返回一个包装组件
//   2. 在渲染前比较 prevProps 和 nextProps
//   3. 相同 → 跳过渲染，复用上次结果
//   4. 不同 → 正常渲染
//
// areEqual 参数：
//   - 不传 → 默认用 shallowEqual
//   - 传了 → 用自定义比较函数
//   - 注意：areEqual 返回 true = 相等 = 跳过渲染
//     （和 shouldComponentUpdate 相反！SCU 返回 true = 需要渲染）

function memo(Component, areEqual) {
  const compare = areEqual || shallowEqual;

  // 缓存上次的 props 和渲染结果
  let prevProps = null;
  let prevResult = null;

  return function MemoComponent(props) {
    // 如果 props 没变，返回缓存的结果
    if (prevProps !== null && compare(prevProps, props)) {
      console.log(`  [memo] ${Component.name}: props 未变，跳过渲染`);
      return prevResult;
    }

    console.log(`  [memo] ${Component.name}: props 变了，重新渲染`);
    prevProps = props;
    prevResult = Component(props);
    return prevResult;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、PureComponent
// ═══════════════════════════════════════════════════════════════════════════
//
// PureComponent = Component + 自动 shouldComponentUpdate
// shouldComponentUpdate 中对 props 和 state 都做浅比较
//
// 与 React.memo 的区别：
//   PureComponent → Class 组件，比较 props + state
//   React.memo    → 函数组件，只比较 props

class Component {
  constructor(props) {
    this.props = props;
    this.state = {};
  }

  setState(partialState) {
    const prevState = this.state;
    const prevProps = this.props;
    this.state = { ...this.state, ...partialState };

    // 调用 shouldComponentUpdate 判断是否需要重渲染
    if (this.shouldComponentUpdate(this.props, this.state, prevProps, prevState)) {
      console.log(`  [${this.constructor.name}] state 变了，重新渲染`);
      this.render();
    } else {
      console.log(`  [${this.constructor.name}] shouldComponentUpdate → false，跳过渲染`);
    }
  }

  shouldComponentUpdate() {
    return true; // 默认：总是重渲染
  }

  render() {}
}

class PureComponent extends Component {
  // 自动浅比较 props 和 state
  shouldComponentUpdate(nextProps, nextState, prevProps, prevState) {
    return (
      !shallowEqual(prevProps || this.props, nextProps) ||
      !shallowEqual(prevState || this.state, nextState)
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== React.memo / PureComponent 演示 ===\n");

// ── 测试 1：shallowEqual ──

console.log("【测试 1】shallowEqual\n");

const cases = [
  [{ a: 1, b: 2 }, { a: 1, b: 2 }, true, "相同值 → true"],
  [{ a: 1, b: 2 }, { a: 1, b: 3 }, false, "不同值 → false"],
  [{ a: 1 }, { a: 1, b: 2 }, false, "key 数量不同 → false"],
  [{ a: { x: 1 } }, { a: { x: 1 } }, false, "嵌套对象新引用 → false（只浅比较!）"],
  [1, 1, true, "基本类型相等 → true"],
  [NaN, NaN, true, "NaN === NaN → true（Object.is）"],
  [null, null, true, "null === null → true"],
  [null, {}, false, "null vs 对象 → false"],
];

cases.forEach(([a, b, expected, desc]) => {
  const result = shallowEqual(a, b);
  const pass = result === expected ? "PASS" : "FAIL";
  console.log(`  [${pass}] ${desc}: shallowEqual(${JSON.stringify(a)}, ${JSON.stringify(b)}) → ${result}`);
});

// ── 测试 2：React.memo ──

console.log("\n【测试 2】React.memo\n");

function ExpensiveList({ items, onClick }) {
  return `渲染了 ${items.length} 项`;
}

const MemoizedList = memo(ExpensiveList);

// 第一次渲染
const items = [1, 2, 3];
const onClick = () => {};
MemoizedList({ items, onClick });

// 同引用 → 跳过
MemoizedList({ items, onClick });

// 新引用（即使内容相同）→ 重新渲染
MemoizedList({ items: [1, 2, 3], onClick });

// ── 测试 3：memo + 稳定引用 ──

console.log("\n【测试 3】memo 配合稳定引用 vs 不稳定引用\n");

console.log("  场景 A：每次传新函数（不用 useCallback）");
const MemoChild = memo(function Child({ onClick }) {
  return "child rendered";
});

const fn1 = () => {};
const fn2 = () => {};
MemoChild({ onClick: fn1 });
MemoChild({ onClick: fn2 }); // fn1 !== fn2 → 重新渲染（memo 失效!）

console.log("\n  场景 B：传稳定引用（用 useCallback）");
const stableFn = () => {};    // 模拟 useCallback 返回的稳定引用
MemoChild({ onClick: stableFn });
MemoChild({ onClick: stableFn }); // 同引用 → 跳过渲染

// ── 测试 4：自定义比较 ──

console.log("\n【测试 4】memo 自定义比较函数\n");

function UserCard({ user }) {
  return `${user.name} (${user.age})`;
}

// 自定义：只比较 user.id，忽略其他字段变化
const MemoUserCard = memo(UserCard, (prevProps, nextProps) => {
  return prevProps.user.id === nextProps.user.id;
});

MemoUserCard({ user: { id: 1, name: "Alice", age: 20 } });
MemoUserCard({ user: { id: 1, name: "Alice", age: 21 } }); // id 相同 → 跳过
MemoUserCard({ user: { id: 2, name: "Bob", age: 25 } });   // id 不同 → 渲染

// ── 测试 5：PureComponent ──

console.log("\n【测试 5】PureComponent\n");

class Counter extends PureComponent {
  constructor() {
    super({});
    this.state = { count: 0 };
  }

  render() {
    console.log(`  [Counter] render: count=${this.state.count}`);
  }
}

const counter = new Counter();
counter.render();
counter.setState({ count: 1 });  // 值变了 → 渲染
counter.setState({ count: 1 });  // 值没变 → 跳过

console.log("\n\n=== 面试要点 ===");
console.log("1. React 默认：父组件渲染 → 所有子组件重渲染（不管 props 变没变）");
console.log("2. React.memo 对函数组件做浅比较，props 不变则跳过渲染");
console.log("3. PureComponent 对 Class 组件做浅比较（props + state）");
console.log("4. 浅比较只比第一层！嵌套对象/数组每次都是新引用 → 比较失效");
console.log("5. memo + useCallback/useMemo 配合使用才有效：稳定 props 引用");
console.log("6. 自定义比较：React.memo(Comp, areEqual)，areEqual 返回 true = 跳过");
console.log("7. 不要过度优化！memo 本身有比较开销，只在渲染开销大时使用");
