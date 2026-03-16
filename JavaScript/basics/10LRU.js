// ===================== 原版：基于 Map 插入顺序 =====================
class LRUCache {
  constructor(capacity) {
    this.cache = new Map();
    this.capacity = capacity;
  }

  get(key) {
    let cache = this.cache;
    if (cache.has(key)) {
      let temp = cache.get(key);
      cache.delete(key);
      cache.set(key, temp);
      return temp;
    } else {
      return -1;
    }
  }
  put(key, value) {
    let cache = this.cache;
    if (cache.has(key)) {
      cache.delete(key);
    } else if (cache.size >= this.capacity) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
  }
}


// ===================== 优化版：Map 细节打磨 =====================
// 改进点：
//   1. get 减少一次 Map 查询（has + get → get 一次判断）
//   2. put 中复用 get 的"刷新"逻辑，减少重复代码
//   3. 提取 _refresh 方法，语义更清晰
class LRUCacheV2 {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  // 将 key 移动到 Map 末尾（最近使用），利用 delete + set 改变插入顺序
  _refresh(key, value) {
    this.cache.delete(key);
    this.cache.set(key, value);
  }

  get(key) {
    // 一次 get 调用代替 has + get 两次查询
    const value = this.cache.get(key);
    if (value === undefined) return -1;
    this._refresh(key, value);
    return value;
  }

  put(key, value) {
    if (this.cache.has(key)) {
      this._refresh(key, value);
      return;
    }
    if (this.cache.size >= this.capacity) {
      // Map.keys() 迭代器的第一个元素就是最早插入的（最久未使用）
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }
}


// ===================== 进阶版：双向链表 + HashMap =====================
// 为什么要用链表？
//   Map 版依赖了 V8 引擎对 Map 插入顺序的实现细节
//   双向链表才是 LRU 的"正统"数据结构实现，面试中更被认可
//   链表节点的移动/删除是真正的 O(1)，不依赖任何引擎行为
//
// 数据结构：
//   HashMap: key → Node，O(1) 查找
//   双向链表: head ↔ node ↔ node ↔ ... ↔ tail
//            ← 最久未使用            最近使用 →
//   head 和 tail 是哨兵节点，简化边界处理

class ListNode {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
  }
}

class LRUCacheV3 {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();

    // 哨兵节点：避免处理 null 边界
    // head ↔ tail 初始时直接相连，真正的数据节点插在它们中间
    this.head = new ListNode(0, 0);
    this.tail = new ListNode(0, 0);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // 从链表中摘除一个节点 O(1)
  _removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  // 将节点插到 tail 前面（标记为"最近使用"）O(1)
  _addToTail(node) {
    node.prev = this.tail.prev;
    node.next = this.tail;
    this.tail.prev.next = node;
    this.tail.prev = node;
  }

  // 将已有节点移动到链表尾部（最近使用）
  _moveToTail(node) {
    this._removeNode(node);
    this._addToTail(node);
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) return -1;
    this._moveToTail(node); // 标记为最近使用
    return node.value;
  }

  put(key, value) {
    const existingNode = this.map.get(key);

    if (existingNode) {
      existingNode.value = value; // 更新值
      this._moveToTail(existingNode);
      return;
    }

    // 容量满了，淘汰链表头部（最久未使用）的节点
    if (this.map.size >= this.capacity) {
      const lruNode = this.head.next; // head 后面第一个就是最久未使用的
      this._removeNode(lruNode);
      this.map.delete(lruNode.key); // 用节点上存的 key 去 map 中删除
    }

    const newNode = new ListNode(key, value);
    this._addToTail(newNode);
    this.map.set(key, newNode);
  }
}


// ===================== 测试 =====================
function testLRU(name, CacheClass) {
  console.log(`\n--- ${name} ---`);
  const cache = new CacheClass(2);
  cache.put(1, 1);
  cache.put(2, 2);
  console.log(cache.get(1));    // 1（key=1 被刷新为最近使用）
  cache.put(3, 3);              // 容量满，淘汰 key=2
  console.log(cache.get(2));    // -1（已被淘汰）
  cache.put(4, 4);              // 容量满，淘汰 key=1
  console.log(cache.get(1));    // -1（已被淘汰）
  console.log(cache.get(3));    // 3
  console.log(cache.get(4));    // 4
}

testLRU("原版 Map", LRUCache);
testLRU("优化版 Map", LRUCacheV2);
testLRU("双向链表 + HashMap", LRUCacheV3);
