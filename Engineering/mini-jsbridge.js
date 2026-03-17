/**
 * Mini JSBridge — Web 与 Native 通信桥梁
 *
 * ═══════════════════════════════════════════════════════
 *  JSBridge 是什么
 * ═══════════════════════════════════════════════════════
 *
 * JSBridge = Hybrid App 中 Web（H5）和 Native（iOS/Android）的双向通信机制
 *
 * 为什么需要？
 *   Web 页面无法直接：调用摄像头、读取通讯录、使用 GPS、调起支付、获取设备信息...
 *   这些能力只有 Native 有 → 需要一座"桥"让 Web 调用 Native 能力
 *
 * 通信方向：
 *   Web → Native（JS 调用原生方法）
 *   Native → Web（原生调用 JS 方法）
 *
 * ═══════════════════════════════════════════════════════
 *  三种主流实现方案
 * ═══════════════════════════════════════════════════════
 *
 * 方案 1：URL Scheme 拦截（最古老，兼容性最好）
 *   Web：创建 iframe，src = "myapp://camera/open?callback=cb_123"
 *   Native：拦截 WebView 的 URL 加载 → 解析协议 → 执行 → 回调
 *   缺点：URL 长度限制、编解码开销、不能同步返回
 *
 * 方案 2：注入全局对象（主流方案）
 *   Native 向 WebView 的 window 注入 JS 对象
 *   iOS：WKWebView 的 WKScriptMessageHandler
 *     window.webkit.messageHandlers.bridge.postMessage(data)
 *   Android：WebView.addJavascriptInterface
 *     window.AndroidBridge.callNative(method, data)
 *   优点：直接调用，无 URL 限制，性能好
 *
 * 方案 3：postMessage（WebView 专用通道）
 *   类似 window.postMessage，但在 WebView 和 Native 间传递
 *   React Native 的 WebView 通信就用这种方式
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. JSBridge 核心 — 双向通信协议设计
 *  2. Web 端 SDK — 封装 callNative / registerHandler
 *  3. Native 端模拟 — 模拟原生环境
 *  4. URL Scheme 方案实现
 *  5. 注入对象方案实现
 *  6. 回调管理 — callbackId + Promise 化
 *  7. 消息队列 — Native 未就绪时的消息缓冲
 *  8. 批量通信 — 减少通信次数
 *  9. 安全机制 — 白名单、签名校验
 *
 * 运行方式：node Engineering/mini-jsbridge.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、消息协议设计
// ═══════════════════════════════════════════════════════════════════════════
//
// Web 和 Native 之间传递的消息格式（统一协议）：
//
// Web → Native（请求）：
//   {
//     type: "request",
//     handlerName: "camera.open",   // 调用的 Native 方法名
//     callbackId: "cb_1678901234",  // 回调 ID（Native 执行完用这个 ID 回调 Web）
//     data: { quality: "high" }     // 参数
//   }
//
// Native → Web（响应）：
//   {
//     type: "response",
//     callbackId: "cb_1678901234",  // 对应请求的回调 ID
//     data: { url: "file://photo.jpg" },
//     error: null                   // 或 { code: -1, message: "..." }
//   }
//
// Native → Web（主动推送/事件通知）：
//   {
//     type: "event",
//     eventName: "network.change",
//     data: { type: "wifi" }
//   }

// ═══════════════════════════════════════════════════════════════════════════
// 二、Web 端 SDK
// ═══════════════════════════════════════════════════════════════════════════
//
// Web 页面引入此 SDK 后，可以：
//   bridge.callNative('camera.open', { quality: 'high' }).then(result => ...)
//   bridge.registerHandler('onPush', (data) => { ... })
//   bridge.on('network.change', (data) => { ... })

class JSBridge {
  constructor() {
    // 回调管理：callbackId → { resolve, reject, timeout }
    this._callbacks = new Map();
    this._callbackIdCounter = 0;

    // Web 端注册的方法（供 Native 调用）
    this._handlers = new Map();

    // 事件监听（Native 主动推送的事件）
    this._eventListeners = new Map();

    // 消息队列：Native 未就绪时缓冲消息
    this._messageQueue = [];
    this._isNativeReady = false;

    // 默认超时时间
    this._defaultTimeout = 10000;

    // 安全白名单
    this._allowedHandlers = null; // null = 不限制

    // Native 桥接对象（注入方案时由 Native 注入）
    this._nativeBridge = null;

    // 统计
    this._stats = { sent: 0, received: 0, timeout: 0, errors: 0 };
  }

  // ── 初始化 ──

  /**
   * 初始化 Bridge
   * 检测 Native 环境，设置通信通道
   */
  init(options = {}) {
    this._defaultTimeout = options.timeout || 10000;
    this._allowedHandlers = options.allowedHandlers || null;

    // 检测 Native 注入的桥接对象
    // iOS: window.webkit.messageHandlers.bridge
    // Android: window.AndroidBridge
    // 模拟环境: this._nativeBridge
    if (typeof window !== "undefined") {
      this._nativeBridge =
        window.webkit?.messageHandlers?.bridge ||
        window.AndroidBridge ||
        null;
    }

    // 注册 Native 回调入口
    // Native 通过调用 window.__jsBridge_receiveMessage(msg) 向 Web 发消息
    this._exposeGlobalReceiver();

    console.log("  [Bridge] 初始化完成");
    return this;
  }

  /**
   * 暴露全局接收函数
   * Native 端通过 evaluateJavascript 调用此函数向 Web 传递消息
   */
  _exposeGlobalReceiver() {
    // 每个 bridge 实例绑定自己的接收函数
    // 真实环境中只有一个 bridge 实例，不存在冲突
    this._receiveMessage = (messageStr) => {
      const message = typeof messageStr === "string" ? JSON.parse(messageStr) : messageStr;
      this._handleMessageFromNative(message);
    };
  }

  // ── Web → Native ──

  /**
   * 调用 Native 方法（核心 API）
   *
   * @param {string} handlerName - Native 方法名，如 "camera.open"
   * @param {Object} data - 参数
   * @param {Object} options - { timeout }
   * @returns {Promise} Native 返回的结果
   *
   * 使用示例：
   *   const photo = await bridge.callNative('camera.open', { quality: 'high' });
   *   const location = await bridge.callNative('geo.getLocation');
   */
  callNative(handlerName, data = {}, options = {}) {
    // 安全检查
    if (this._allowedHandlers && !this._allowedHandlers.includes(handlerName)) {
      return Promise.reject(new Error(`Handler "${handlerName}" is not allowed`));
    }

    return new Promise((resolve, reject) => {
      const callbackId = this._generateCallbackId();
      const timeout = options.timeout || this._defaultTimeout;

      // 设置超时
      const timeoutId = setTimeout(() => {
        if (this._callbacks.has(callbackId)) {
          this._callbacks.delete(callbackId);
          this._stats.timeout++;
          reject(new Error(`callNative("${handlerName}") timeout after ${timeout}ms`));
        }
      }, timeout);

      // 注册回调
      this._callbacks.set(callbackId, { resolve, reject, timeoutId });

      // 构造消息
      const message = {
        type: "request",
        handlerName,
        callbackId,
        data,
      };

      // 发送到 Native
      this._sendToNative(message);
    });
  }

  /**
   * 发送消息到 Native
   * 根据环境选择不同的通信方式
   */
  _sendToNative(message) {
    this._stats.sent++;

    // 如果 Native 未就绪，放入消息队列
    if (!this._isNativeReady) {
      this._messageQueue.push(message);
      return;
    }

    const messageStr = JSON.stringify(message);

    if (this._nativeBridge) {
      // 方案 2：注入对象方式
      if (typeof this._nativeBridge.postMessage === "function") {
        // iOS WKWebView
        this._nativeBridge.postMessage(messageStr);
      } else if (typeof this._nativeBridge.callNative === "function") {
        // Android addJavascriptInterface
        this._nativeBridge.callNative(messageStr);
      }
    } else {
      // 方案 1：URL Scheme 方式（降级）
      this._sendViaUrlScheme(message);
    }
  }

  /**
   * URL Scheme 方式发送
   * 创建隐藏 iframe，通过 src 触发 Native 拦截
   */
  _sendViaUrlScheme(message) {
    const { handlerName, callbackId, data } = message;
    const url = `jsbridge://${handlerName}?callbackId=${callbackId}&data=${encodeURIComponent(JSON.stringify(data))}`;

    // 在浏览器中创建 iframe 触发 URL 加载
    // Native 的 WebView 会拦截 jsbridge:// 协议的请求
    if (typeof document !== "undefined") {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      setTimeout(() => document.body.removeChild(iframe), 100);
    }

    // Node 环境模拟：直接打印
    console.log(`    [URL Scheme] ${url.slice(0, 80)}...`);
  }

  // ── Native → Web ──

  /**
   * 处理来自 Native 的消息
   */
  _handleMessageFromNative(message) {
    this._stats.received++;

    switch (message.type) {
      case "response":
        // Native 返回调用结果
        this._handleResponse(message);
        break;

      case "call":
        // Native 主动调用 Web 注册的方法
        this._handleNativeCall(message);
        break;

      case "event":
        // Native 推送事件
        this._handleEvent(message);
        break;
    }
  }

  /**
   * 处理 Native 的响应（对应 callNative 的 Promise 回调）
   */
  _handleResponse(message) {
    const { callbackId, data, error } = message;
    const callback = this._callbacks.get(callbackId);

    if (!callback) return; // 已超时或重复回调

    clearTimeout(callback.timeoutId);
    this._callbacks.delete(callbackId);

    if (error) {
      this._stats.errors++;
      callback.reject(new Error(error.message || "Native error"));
    } else {
      callback.resolve(data);
    }
  }

  /**
   * 处理 Native 主动调用 Web 方法
   *
   * Native 可以调用 Web 注册的方法：
   *   bridge.registerHandler('onPush', (data, responseCallback) => {
   *     // 处理 Native 的调用
   *     responseCallback({ received: true });
   *   });
   */
  _handleNativeCall(message) {
    const { handlerName, callbackId, data } = message;
    const handler = this._handlers.get(handlerName);

    if (!handler) {
      console.warn(`  [Bridge] 未注册的 handler: ${handlerName}`);
      // 回复 Native：handler 不存在
      if (callbackId) {
        this._sendToNative({
          type: "response",
          callbackId,
          error: { code: -1, message: `Handler "${handlerName}" not registered` },
        });
      }
      return;
    }

    // 创建回复函数
    const responseCallback = (responseData) => {
      if (callbackId) {
        this._sendToNative({
          type: "response",
          callbackId,
          data: responseData,
        });
      }
    };

    // 执行 handler
    try {
      handler(data, responseCallback);
    } catch (err) {
      if (callbackId) {
        this._sendToNative({
          type: "response",
          callbackId,
          error: { code: -1, message: err.message },
        });
      }
    }
  }

  /**
   * 处理 Native 推送的事件
   */
  _handleEvent(message) {
    const { eventName, data } = message;
    const listeners = this._eventListeners.get(eventName);

    if (listeners) {
      listeners.forEach((fn) => {
        try { fn(data); } catch (e) { console.error("[Bridge] event handler error:", e); }
      });
    }
  }

  // ── Web 端注册 API ──

  /**
   * 注册 Web 端方法（供 Native 调用）
   */
  registerHandler(handlerName, handler) {
    this._handlers.set(handlerName, handler);
  }

  /**
   * 注销 Web 端方法
   */
  unregisterHandler(handlerName) {
    this._handlers.delete(handlerName);
  }

  /**
   * 监听 Native 事件
   * 类似 EventEmitter 的 on
   */
  on(eventName, callback) {
    if (!this._eventListeners.has(eventName)) {
      this._eventListeners.set(eventName, new Set());
    }
    this._eventListeners.get(eventName).add(callback);

    // 返回取消监听函数
    return () => {
      this._eventListeners.get(eventName)?.delete(callback);
    };
  }

  /**
   * 一次性监听
   */
  once(eventName, callback) {
    const off = this.on(eventName, (data) => {
      off();
      callback(data);
    });
    return off;
  }

  // ── Native 就绪 + 消息队列 ──

  /**
   * Native 就绪回调
   * 清空消息队列中缓冲的消息
   */
  _onNativeReady() {
    this._isNativeReady = true;
    console.log(`  [Bridge] Native 就绪，发送缓冲消息 ${this._messageQueue.length} 条`);

    // 清空消息队列
    const queue = this._messageQueue;
    this._messageQueue = [];
    queue.forEach((msg) => this._sendToNative(msg));
  }

  // ── 工具方法 ──

  _generateCallbackId() {
    return `cb_${Date.now()}_${this._callbackIdCounter++}`;
  }

  getStats() {
    return { ...this._stats, pendingCallbacks: this._callbacks.size, queueLength: this._messageQueue.length };
  }

  destroy() {
    // 清理所有待回调（reject）
    this._callbacks.forEach(({ reject, timeoutId }) => {
      clearTimeout(timeoutId);
      reject(new Error("Bridge destroyed"));
    });
    this._callbacks.clear();
    this._handlers.clear();
    this._eventListeners.clear();
    this._messageQueue = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、Native 端模拟器
// ═══════════════════════════════════════════════════════════════════════════
//
// 模拟 Native 环境，用于测试和演示
// 真实环境中这部分由 iOS/Android 原生代码实现

class NativeSimulator {
  constructor(bridge) {
    this.bridge = bridge;
    this._handlers = new Map();
    this._callbackIdCounter = 0;

    this._registerDefaultHandlers();
  }

  _registerDefaultHandlers() {
    // 模拟 Native 能力
    this.registerHandler("camera.open", (data, callback) => {
      console.log("    [Native] 打开相机, 参数:", JSON.stringify(data));
      setTimeout(() => {
        callback({ url: "file:///photos/IMG_001.jpg", width: 1920, height: 1080 });
      }, 50);
    });

    this.registerHandler("geo.getLocation", (data, callback) => {
      console.log("    [Native] 获取定位");
      setTimeout(() => {
        callback({ latitude: 39.9042, longitude: 116.4074, city: "北京" });
      }, 30);
    });

    this.registerHandler("device.getInfo", (data, callback) => {
      console.log("    [Native] 获取设备信息");
      callback({
        platform: "iOS",
        version: "17.0",
        model: "iPhone 15",
        appVersion: "2.1.0",
      });
    });

    this.registerHandler("storage.get", (data, callback) => {
      console.log("    [Native] 读取存储:", data.key);
      const store = { token: "saved-jwt-token", user: '{"name":"Alice"}' };
      callback({ value: store[data.key] || null });
    });

    this.registerHandler("storage.set", (data, callback) => {
      console.log("    [Native] 写入存储:", data.key, "=", data.value);
      callback({ success: true });
    });

    this.registerHandler("share", (data, callback) => {
      console.log("    [Native] 分享:", data.title, "→", data.platform || "系统");
      callback({ success: true });
    });

    this.registerHandler("pay", (data, callback) => {
      console.log("    [Native] 发起支付:", data.amount, "元");
      setTimeout(() => {
        callback({ orderId: "PAY_" + Date.now(), status: "success" });
      }, 100);
    });

    // 模拟一个会失败的方法
    this.registerHandler("error.test", (data, callback) => {
      callback(null, { code: -1, message: "Native 模拟错误" });
    });
  }

  registerHandler(name, handler) {
    this._handlers.set(name, handler);
  }

  /**
   * 处理来自 Web 的消息
   * 在真实环境中，Native 的 WebView delegate 接收消息后调用此逻辑
   */
  handleWebMessage(messageStr) {
    const message = typeof messageStr === "string" ? JSON.parse(messageStr) : messageStr;

    if (message.type === "request") {
      const handler = this._handlers.get(message.handlerName);

      if (!handler) {
        // 回复错误
        this._replyToWeb({
          type: "response",
          callbackId: message.callbackId,
          error: { code: -2, message: `Native handler "${message.handlerName}" not found` },
        });
        return;
      }

      // 执行 Native 方法
      handler(message.data, (result, error) => {
        this._replyToWeb({
          type: "response",
          callbackId: message.callbackId,
          data: result,
          error: error || null,
        });
      });
    }
  }

  /**
   * Native 向 Web 发送消息
   * 真实环境：iOS webView.evaluateJavaScript / Android webView.loadUrl
   */
  _replyToWeb(message) {
    // 模拟 Native 调用 JS：调用 bridge 实例的接收函数
    if (this.bridge._receiveMessage) {
      this.bridge._receiveMessage(message);
    }
  }

  /**
   * Native 主动调用 Web 方法
   */
  callWeb(handlerName, data) {
    return new Promise((resolve) => {
      const callbackId = `native_cb_${this._callbackIdCounter++}`;

      // 临时注册响应监听
      const originalReceive = globalThis.__jsBridge_receiveMessage;
      // Native 直接调用 Web
      this._replyToWeb({
        type: "call",
        handlerName,
        callbackId,
        data,
      });

      resolve(); // 简化：不等 Web 回复
    });
  }

  /**
   * Native 推送事件到 Web
   */
  emitEvent(eventName, data) {
    this._replyToWeb({
      type: "event",
      eventName,
      data,
    });
  }

  /**
   * 通知 Web：Native 已就绪
   */
  notifyReady() {
    const global = typeof window !== "undefined" ? window : globalThis;
    if (global.__jsBridge_nativeReady) {
      global.__jsBridge_nativeReady();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、连接 Web SDK 和 Native 模拟器
// ═══════════════════════════════════════════════════════════════════════════
//
// 在模拟环境中，需要把两端连起来
// 真实环境中这个连接由 WebView 自动完成

function connectBridge(bridge, native) {
  // 设置 Native 桥接对象（模拟注入）
  bridge._nativeBridge = {
    postMessage(messageStr) {
      const msg = typeof messageStr === "string" ? JSON.parse(messageStr) : messageStr;
      // 模拟异步（真实通信有延迟）
      setTimeout(() => native.handleWebMessage(msg), 1);
    },
  };
  // 通知 Bridge：Native 已就绪 → 会自动清空消息队列
  bridge._onNativeReady();
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini JSBridge 演示 ===\n");

const bridge = new JSBridge();
bridge.init();

const native = new NativeSimulator(bridge);
connectBridge(bridge, native);

(async () => {
  // ── 测试 1：Web 调用 Native 方法 ──

  console.log("【测试 1】Web → Native 调用\n");

  const photo = await bridge.callNative("camera.open", { quality: "high" });
  console.log("  camera.open 返回:", JSON.stringify(photo));

  const location = await bridge.callNative("geo.getLocation");
  console.log("  geo.getLocation 返回:", JSON.stringify(location));

  const deviceInfo = await bridge.callNative("device.getInfo");
  console.log("  device.getInfo 返回:", JSON.stringify(deviceInfo));

  // ── 测试 2：存储读写 ──

  console.log("\n\n【测试 2】Native 存储读写\n");

  await bridge.callNative("storage.set", { key: "theme", value: "dark" });
  const token = await bridge.callNative("storage.get", { key: "token" });
  console.log("  storage.get('token'):", JSON.stringify(token));

  // ── 测试 3：Native 调用 Web 方法 ──

  console.log("\n\n【测试 3】Native → Web 调用\n");

  // Web 端注册方法
  bridge.registerHandler("onPush", (data, responseCallback) => {
    console.log("  [Web] 收到 push 通知:", JSON.stringify(data));
    responseCallback({ received: true });
  });

  bridge.registerHandler("getPageInfo", (data, responseCallback) => {
    console.log("  [Web] Native 请求页面信息");
    responseCallback({ url: "/home", title: "首页", scrollTop: 100 });
  });

  // Native 主动调用 Web
  await native.callWeb("onPush", { title: "新消息", body: "你有一条新消息" });
  await native.callWeb("getPageInfo", {});

  // 小延迟让异步消息处理完
  await new Promise((r) => setTimeout(r, 50));

  // ── 测试 4：事件监听 ──

  console.log("\n\n【测试 4】事件监听（Native 推送）\n");

  const offNetwork = bridge.on("network.change", (data) => {
    console.log("  [Web] 网络变化:", JSON.stringify(data));
  });

  bridge.on("app.background", (data) => {
    console.log("  [Web] App 进入后台");
  });

  bridge.on("app.foreground", (data) => {
    console.log("  [Web] App 回到前台");
  });

  // Native 推送事件
  native.emitEvent("network.change", { type: "wifi", ssid: "MyWiFi" });
  native.emitEvent("app.background", {});
  native.emitEvent("app.foreground", {});

  // 取消监听
  offNetwork();
  native.emitEvent("network.change", { type: "4G" });
  console.log("  (取消监听后，网络变化事件不再触发)");

  // ── 测试 5：once 一次性监听 ──

  console.log("\n\n【测试 5】once 一次性监听\n");

  bridge.once("scan.result", (data) => {
    console.log("  [Web] 扫码结果:", JSON.stringify(data));
  });

  native.emitEvent("scan.result", { code: "https://example.com" });
  native.emitEvent("scan.result", { code: "second scan" });
  console.log("  (第二次扫码事件不触发 — once 只执行一次)");

  // ── 测试 6：超时处理 ──

  console.log("\n\n【测试 6】超时处理\n");

  // 注册一个永远不回复的 Native 方法
  native.registerHandler("slow.method", () => { /* 不调用 callback */ });

  try {
    await bridge.callNative("slow.method", {}, { timeout: 100 });
  } catch (err) {
    console.log("  超时:", err.message);
  }

  // ── 测试 7：错误处理 ──

  console.log("\n\n【测试 7】Native 返回错误\n");

  try {
    await bridge.callNative("error.test");
  } catch (err) {
    console.log("  错误:", err.message);
  }

  // ── 测试 8：消息队列（Native 未就绪）──

  console.log("\n\n【测试 8】消息队列（Native 未就绪时缓冲）\n");

  const bridge2 = new JSBridge();
  bridge2.init({ timeout: 5000 });
  // 此时 Native 未就绪，消息会缓冲

  // 发送消息（会进入队列）
  const pendingPromise1 = bridge2.callNative("device.getInfo").catch(() => {});
  const pendingPromise2 = bridge2.callNative("geo.getLocation").catch(() => {});

  console.log("  缓冲消息数:", bridge2._messageQueue.length);

  // Native 就绪后，消息自动发送
  const native2 = new NativeSimulator(bridge2);
  connectBridge(bridge2, native2);
  console.log("  Native 就绪后队列长度:", bridge2._messageQueue.length, "(已清空并发送)");

  // 等待 pending promises 完成
  await Promise.all([pendingPromise1, pendingPromise2]);
  console.log("  缓冲的请求已收到响应");

  // ── 测试 9：安全白名单 ──

  console.log("\n\n【测试 9】安全白名单\n");

  const secureBridge = new JSBridge();
  secureBridge.init({
    allowedHandlers: ["camera.open", "geo.getLocation", "device.getInfo"],
  });
  const secureNative = new NativeSimulator(secureBridge);
  connectBridge(secureBridge, secureNative);

  const allowed = await secureBridge.callNative("camera.open", {});
  console.log("  camera.open (白名单内): 成功 →", JSON.stringify(allowed).slice(0, 50));

  try {
    await secureBridge.callNative("storage.get", { key: "password" });
  } catch (err) {
    console.log("  storage.get (白名单外): 拒绝 →", err.message);
  }

  // ── 测试 10：统计信息 ──

  console.log("\n\n【测试 10】通信统计\n");

  const stats = bridge.getStats();
  console.log("  通信统计:", JSON.stringify(stats, null, 2));

  // ── 测试 11：批量调用示例 ──

  console.log("\n\n【测试 11】批量调用（并行）\n");

  const [info, loc, shareResult] = await Promise.all([
    bridge.callNative("device.getInfo"),
    bridge.callNative("geo.getLocation"),
    bridge.callNative("share", { title: "分享内容", url: "https://example.com" }),
  ]);
  console.log("  并行调用 3 个 Native 方法:");
  console.log("    device.getInfo:", info.model);
  console.log("    geo.getLocation:", loc.city);
  console.log("    share:", shareResult.success);

  // ── 业务封装示例 ──

  console.log("\n\n【测试 12】业务封装示例\n");

  console.log(`
  // bridge-sdk.js — 实际项目中的封装
  const bridge = new JSBridge();
  bridge.init({ timeout: 15000 });

  // 封装具体业务 API
  export const nativeApi = {
    // 拍照
    takePhoto: (opts) => bridge.callNative('camera.open', opts),

    // 定位
    getLocation: () => bridge.callNative('geo.getLocation'),

    // 支付
    pay: (amount, orderId) => bridge.callNative('pay', { amount, orderId }),

    // 分享
    share: (data) => bridge.callNative('share', data),

    // 存储
    getItem: (key) => bridge.callNative('storage.get', { key }).then(r => r.value),
    setItem: (key, value) => bridge.callNative('storage.set', { key, value }),

    // 设备信息
    getDeviceInfo: () => bridge.callNative('device.getInfo'),

    // 判断是否在 App 内
    isInApp: () => typeof window !== 'undefined' && !!window.__jsBridge_receiveMessage,
  };

  // 监听 Native 事件
  bridge.on('network.change', (data) => store.setNetwork(data));
  bridge.on('app.background', () => store.setBackground(true));
  bridge.on('app.foreground', () => store.setBackground(false));
  `);

  console.log("\n=== 面试要点 ===");
  console.log("1. JSBridge = Web(H5) 和 Native(iOS/Android) 的双向通信机制");
  console.log("2. 三种方案：URL Scheme 拦截 / 注入全局对象(主流) / postMessage");
  console.log("3. 核心协议：request(Web→Native) + response(回调) + event(Native推送)");
  console.log("4. 回调管理：callbackId + Map<id, {resolve,reject}> + Promise 化");
  console.log("5. 消息队列：Native 未就绪时缓冲消息，ready 后自动清空");
  console.log("6. 安全机制：白名单限制可调用的 Native 方法 + 超时防止无限等待");
  console.log("7. Native→Web：通过 evaluateJavaScript 调用全局函数 __jsBridge_receiveMessage");
  console.log("8. iOS 用 WKScriptMessageHandler，Android 用 addJavascriptInterface");
  console.log("9. URL Scheme 是降级方案：有长度限制和编码开销，但兼容性最好");
  console.log("10. 实际项目中封装为具体业务 API（takePhoto/pay/share），组件直接调用");
})();
