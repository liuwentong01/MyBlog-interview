/**
 * Virtual List（虚拟列表）实现
 *
 * ═══════════════════════════════════════════════════════
 *  为什么需要虚拟列表？
 * ═══════════════════════════════════════════════════════
 *
 * 场景：渲染 10000 条数据的列表
 *
 * 普通渲染：
 *   10000 个 DOM 节点 → 内存占用大 + 首次渲染慢 + 滚动卡顿
 *   每个 DOM 节点约占 1-2KB 内存 → 10000 个 = 10-20MB
 *
 * 虚拟列表：
 *   只渲染可视区域的 DOM（约 20-30 个）
 *   滚动时动态替换可视区域的内容
 *   10000 条数据 → 始终只有约 30 个 DOM 节点
 *
 * ═══════════════════════════════════════════════════════
 *  核心原理
 * ═══════════════════════════════════════════════════════
 *
 * 结构：
 *   ┌────────────────────── container（固定高度，overflow: auto）
 *   │ ┌────────────────── phantom（撑开总高度，制造滚动条）
 *   │ │                      height = itemCount * itemHeight
 *   │ │
 *   │ │ ┌──────────── content（实际渲染的列表项）
 *   │ │ │                transform: translateY(offset)
 *   │ │ │  ┌─ item ─┐
 *   │ │ │  ├─ item ─┤   ← 只渲染可视区域 + buffer
 *   │ │ │  ├─ item ─┤
 *   │ │ │  └─ item ─┘
 *   │ │ └────────────
 *   │ └──────────────────
 *   └──────────────────────
 *
 * 滚动时的计算：
 *   scrollTop = container.scrollTop  ← 用户滚动了多少
 *   startIndex = Math.floor(scrollTop / itemHeight)  ← 第一个可见项
 *   endIndex = startIndex + visibleCount  ← 最后一个可见项
 *   offset = startIndex * itemHeight  ← content 的 translateY 偏移
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. 定高虚拟列表（每项高度固定，最简单也最常见）
 *  2. 带 buffer 的虚拟列表（上下多渲染几项，避免滚动白屏）
 *  3. 不定高虚拟列表（每项高度不同，需要预估 + 动态测量）
 *
 * 运行方式：node React/mini-virtual-list.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、定高虚拟列表
// ═══════════════════════════════════════════════════════════════════════════
//
// 最简单的情况：每项高度相同
// 所有计算都是 O(1)：直接用 scrollTop / itemHeight 算出索引

class FixedSizeList {
  /**
   * @param {Object} options
   * @param {number} options.itemCount    - 总数据条数
   * @param {number} options.itemHeight   - 每项的固定高度（px）
   * @param {number} options.containerHeight - 容器可视高度（px）
   * @param {number} options.bufferCount  - 上下缓冲区项数（默认 5）
   */
  constructor({ itemCount, itemHeight, containerHeight, bufferCount = 5 }) {
    this.itemCount = itemCount;
    this.itemHeight = itemHeight;
    this.containerHeight = containerHeight;
    this.bufferCount = bufferCount;

    // 可视区域能放多少项（向上取整）
    this.visibleCount = Math.ceil(containerHeight / itemHeight);

    // 总高度（用于撑开滚动条）
    this.totalHeight = itemCount * itemHeight;
  }

  /**
   * 根据 scrollTop 计算当前应该渲染哪些项
   *
   * 核心公式：
   *   startIndex = floor(scrollTop / itemHeight) - bufferCount
   *   endIndex = startIndex + visibleCount + bufferCount * 2
   *   offset = startIndex * itemHeight  (content 的 translateY)
   */
  getRenderRange(scrollTop) {
    // 第一个可见项的索引
    const startIndex = Math.floor(scrollTop / this.itemHeight);

    // 加上 buffer（上下各多渲染几项）
    const bufferStart = Math.max(0, startIndex - this.bufferCount);
    const bufferEnd = Math.min(
      this.itemCount - 1,
      startIndex + this.visibleCount + this.bufferCount
    );

    return {
      startIndex: bufferStart,
      endIndex: bufferEnd,
      offset: bufferStart * this.itemHeight,  // content 容器的 translateY
      visibleStart: startIndex,                // 实际可见的第一项（不含 buffer）
      visibleEnd: Math.min(startIndex + this.visibleCount - 1, this.itemCount - 1),
    };
  }

  /**
   * 模拟滚动，返回渲染结果
   */
  onScroll(scrollTop) {
    const range = this.getRenderRange(scrollTop);

    // 要渲染的项
    const items = [];
    for (let i = range.startIndex; i <= range.endIndex; i++) {
      items.push({
        index: i,
        top: i * this.itemHeight,              // 绝对位置
        isBuffer: i < range.visibleStart || i > range.visibleEnd,
      });
    }

    return {
      ...range,
      items,
      totalHeight: this.totalHeight,
      renderedCount: items.length,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、不定高虚拟列表
// ═══════════════════════════════════════════════════════════════════════════
//
// 挑战：每项高度不同，无法直接 scrollTop / itemHeight 算索引
//
// 解决方案：
//   1. 预估：先用估计的平均高度初始化位置数组
//   2. 测量：渲染后用真实 DOM 高度更新位置
//   3. 缓存：记住已测量的高度，避免重复测量
//   4. 二分查找：在位置数组中查找 scrollTop 对应的索引
//
// 真实场景：react-virtualized / react-window 的 VariableSizeList

class VariableSizeList {
  /**
   * @param {Object} options
   * @param {number} options.itemCount
   * @param {number} options.estimatedItemHeight - 预估每项高度
   * @param {number} options.containerHeight
   */
  constructor({ itemCount, estimatedItemHeight, containerHeight }) {
    this.itemCount = itemCount;
    this.estimatedItemHeight = estimatedItemHeight;
    this.containerHeight = containerHeight;

    // positions[i] = { index, top, bottom, height }
    // 初始化时用预估高度填充
    this.positions = [];
    this.initPositions();
  }

  initPositions() {
    for (let i = 0; i < this.itemCount; i++) {
      this.positions.push({
        index: i,
        top: i * this.estimatedItemHeight,
        bottom: (i + 1) * this.estimatedItemHeight,
        height: this.estimatedItemHeight,
      });
    }
  }

  get totalHeight() {
    const last = this.positions[this.positions.length - 1];
    return last ? last.bottom : 0;
  }

  /**
   * 渲染后用真实高度更新
   *
   * 真实 React 组件中：在 useEffect / componentDidUpdate 中调用
   * 通过 ResizeObserver 或 ref.current.getBoundingClientRect() 获取真实高度
   */
  updateItemHeight(index, realHeight) {
    const pos = this.positions[index];
    const diff = realHeight - pos.height;
    if (diff === 0) return;

    // 更新当前项
    pos.height = realHeight;
    pos.bottom = pos.top + realHeight;

    // 当前项高度变了 → 后续所有项的 top/bottom 都要更新
    for (let i = index + 1; i < this.positions.length; i++) {
      this.positions[i].top = this.positions[i - 1].bottom;
      this.positions[i].bottom = this.positions[i].top + this.positions[i].height;
    }
  }

  /**
   * 二分查找：找到 scrollTop 对应的起始索引
   *
   * 为什么用二分？
   *   positions 是按 top 升序排列的
   *   线性查找 O(n)，二分查找 O(log n)
   *   10000 项只需约 14 次比较
   */
  findStartIndex(scrollTop) {
    let low = 0;
    let high = this.positions.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const midBottom = this.positions[mid].bottom;

      if (midBottom === scrollTop) {
        return mid + 1;
      } else if (midBottom < scrollTop) {
        low = mid + 1;
      } else {
        // midBottom > scrollTop
        if (mid === 0 || this.positions[mid - 1].bottom <= scrollTop) {
          return mid;
        }
        high = mid - 1;
      }
    }

    return low;
  }

  getRenderRange(scrollTop) {
    const startIndex = this.findStartIndex(scrollTop);
    let endIndex = startIndex;

    // 向下找到可视区域结束的索引
    let accHeight = 0;
    while (endIndex < this.itemCount && accHeight < this.containerHeight) {
      accHeight += this.positions[endIndex].height;
      endIndex++;
    }

    // buffer
    const bufferStart = Math.max(0, startIndex - 3);
    const bufferEnd = Math.min(this.itemCount - 1, endIndex + 3);

    return {
      startIndex: bufferStart,
      endIndex: bufferEnd,
      offset: this.positions[bufferStart].top,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、React 组件伪代码
// ═══════════════════════════════════════════════════════════════════════════
//
// 这就是 react-window 的 FixedSizeList 的简化版

const VirtualListComponent = `
function VirtualList({ data, itemHeight, containerHeight, renderItem }) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = data.length * itemHeight;
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.min(startIndex + visibleCount + 1, data.length);
  const offset = startIndex * itemHeight;

  const visibleItems = data.slice(startIndex, endIndex);

  return (
    <div
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={(e) => setScrollTop(e.target.scrollTop)}
    >
      {/* phantom: 撑开总高度，产生滚动条 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* content: 只渲染可见项，通过 transform 定位 */}
        <div style={{ transform: \\\`translateY(\\\${offset}px)\\\` }}>
          {visibleItems.map((item, i) => renderItem(item, startIndex + i))}
        </div>
      </div>
    </div>
  );
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// 四、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Virtual List 虚拟列表演示 ===\n");

// ── 测试 1：定高虚拟列表 ──

console.log("【测试 1】定高虚拟列表（10000 条，每项 50px，容器 500px）\n");

const fixedList = new FixedSizeList({
  itemCount: 10000,
  itemHeight: 50,
  containerHeight: 500,
  bufferCount: 3,
});

console.log(`  总高度: ${fixedList.totalHeight}px (撑开滚动条)`);
console.log(`  可视项数: ${fixedList.visibleCount}`);

// 模拟不同滚动位置
const scrollPositions = [0, 250, 5000, 49500, 499500];
scrollPositions.forEach((scrollTop) => {
  const result = fixedList.onScroll(scrollTop);
  console.log(
    `\n  scrollTop=${scrollTop}:`,
    `渲染第 ${result.startIndex}-${result.endIndex} 项`,
    `(共 ${result.renderedCount} 个 DOM)`,
    `可见: ${result.visibleStart}-${result.visibleEnd}`,
    result.startIndex !== result.visibleStart ? `buffer: ${result.visibleStart - result.startIndex} 项` : ""
  );
});

console.log(`\n  对比: 10000 个 DOM vs ${fixedList.visibleCount + fixedList.bufferCount * 2} 个 DOM`);

// ── 测试 2：不定高虚拟列表 ──

console.log("\n\n【测试 2】不定高虚拟列表\n");

const variableList = new VariableSizeList({
  itemCount: 100,
  estimatedItemHeight: 50,
  containerHeight: 300,
});

console.log("  初始化（预估高度 50px）:");
console.log(`  总高度: ${variableList.totalHeight}px`);

// 模拟渲染后更新真实高度
console.log("\n  模拟真实渲染（部分项高度不同）:");
variableList.updateItemHeight(0, 80);   // 第 0 项实际 80px
variableList.updateItemHeight(1, 30);   // 第 1 项实际 30px
variableList.updateItemHeight(2, 120);  // 第 2 项实际 120px
console.log(`  更新后总高度: ${variableList.totalHeight}px`);

// 验证位置更新
console.log("\n  位置更新验证:");
for (let i = 0; i < 5; i++) {
  const p = variableList.positions[i];
  console.log(`    第 ${i} 项: top=${p.top} bottom=${p.bottom} height=${p.height}`);
}

// 测试二分查找
console.log("\n  二分查找测试:");
const idx = variableList.findStartIndex(100);
console.log(`  scrollTop=100 → startIndex=${idx} (第 ${idx} 项的 top=${variableList.positions[idx].top})`);

console.log("\n\n=== 面试要点 ===");
console.log("1. 虚拟列表只渲染可视区域 DOM（10000 项 → 约 30 个 DOM 节点）");
console.log("2. 核心公式: startIndex = floor(scrollTop / itemHeight), offset = startIndex * itemHeight");
console.log("3. 结构: container(固定高度+overflow) > phantom(撑总高度) > content(translateY定位)");
console.log("4. buffer: 上下多渲染几项，避免快速滚动时白屏");
console.log("5. 不定高: 预估高度初始化 → 渲染后真实测量 → 更新 positions → 二分查找索引");
console.log("6. 性能: 定高 O(1) 计算，不定高 O(log n) 二分查找");
console.log("7. 常用库: react-window (轻量) / react-virtualized (功能全)");
