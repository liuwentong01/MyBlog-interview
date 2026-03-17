/**
 * Mini Request — 完整请求库封装（参考 axios 核心架构）
 *
 * ═══════════════════════════════════════════════════════
 *  axios 的核心架构
 * ═══════════════════════════════════════════════════════
 *
 * axios 不是简单的 fetch 包装，而是一个完整的请求框架：
 *
 *   请求流程：
 *     config → 请求拦截器链 → 适配器(xhr/fetch/node http) → 响应拦截器链 → 结果
 *
 *   核心模块：
 *     1. Axios 实例（可创建多个，独立配置）
 *     2. 拦截器（请求/响应，链式调用，可拒绝/修改）
 *     3. 适配器（浏览器用 XMLHttpRequest，Node 用 http 模块）
 *     4. 配置合并（默认 < 实例 < 请求级别）
 *     5. 取消请求（AbortController / CancelToken）
 *     6. 请求/响应转换器（自动 JSON 序列化/解析）
 *     7. 超时控制
 *     8. 重试机制
 *     9. 并发控制
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1.  InterceptorManager — 拦截器管理
 *  2.  mergeConfig — 配置合并策略
 *  3.  transformRequest/Response — 请求/响应转换
 *  4.  buildURL — URL 参数序列化
 *  5.  adapter — 请求适配器（模拟 fetch/xhr）
 *  6.  dispatchRequest — 核心分发（拦截器链 + 适配器）
 *  7.  Axios class — 实例，支持 get/post/put/delete 等快捷方法
 *  8.  create — 创建独立实例
 *  9.  CancelToken — 取消请求
 *  10. retry — 请求重试
 *  11. 并发控制 — 限制同时发出的请求数
 *  12. 缓存 — 请求结果缓存（GET 幂等）
 *
 * 运行方式：node Engineering/mini-request.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、InterceptorManager — 拦截器管理器
// ═══════════════════════════════════════════════════════════════════════════
//
// 拦截器是 axios 最核心的设计：
//   请求拦截器：在请求发出前修改 config（加 token、签名、loading 等）
//   响应拦截器：在拿到响应后统一处理（错误码判断、登录过期、数据脱壳）
//
// 执行顺序（重要！）：
//   请求拦截器：后添加的先执行（unshift）→ 类似栈
//   响应拦截器：先添加的先执行（push）→ 类似队列
//
// 链式调用原理：
//   [请求拦截器2, 请求拦截器1, dispatchRequest, 响应拦截器1, 响应拦截器2]
//   整条链用 Promise.then 串联

class InterceptorManager {
  constructor() {
    this.handlers = []; // { fulfilled, rejected, id }
    this._id = 0;
  }

  /**
   * 注册拦截器
   * @param {Function} fulfilled - 成功回调
   * @param {Function} rejected - 失败回调
   * @returns {number} 拦截器 ID（用于移除）
   */
  use(fulfilled, rejected) {
    const id = this._id++;
    this.handlers.push({ fulfilled, rejected, id });
    return id;
  }

  /**
   * 移除拦截器
   * 不真删（保持索引稳定），置 null → 执行时跳过
   */
  eject(id) {
    const idx = this.handlers.findIndex((h) => h && h.id === id);
    if (idx !== -1) {
      this.handlers[idx] = null;
    }
  }

  /**
   * 遍历所有有效拦截器
   */
  forEach(fn) {
    this.handlers.forEach((h) => {
      if (h !== null) fn(h);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、配置合并
// ═══════════════════════════════════════════════════════════════════════════
//
// 三层配置优先级：请求级 > 实例级 > 全局默认
//
// 合并策略（和 axios 一致）：
//   url / method / data → 只用请求级（不合并）
//   headers → 深度合并
//   其他 → 请求级有就用请求级，否则用实例级

const DEFAULTS = {
  method: "GET",
  timeout: 0,
  headers: {
    common: { Accept: "application/json, text/plain, */*" },
    get: {},
    post: { "Content-Type": "application/json" },
    put: { "Content-Type": "application/json" },
    patch: { "Content-Type": "application/json" },
    delete: {},
  },
  // 请求转换器：发送前处理 data
  transformRequest: [
    (data, headers) => {
      if (data && typeof data === "object" && !(data instanceof FormData)) {
        return JSON.stringify(data);
      }
      return data;
    },
  ],
  // 响应转换器：收到后处理 data
  transformResponse: [
    (data) => {
      if (typeof data === "string") {
        try { return JSON.parse(data); } catch (e) { /* ignore */ }
      }
      return data;
    },
  ],
  // 判断哪些状态码算成功
  validateStatus: (status) => status >= 200 && status < 300,
};

function mergeConfig(defaults, instanceConfig, requestConfig) {
  const config = { ...defaults, ...instanceConfig, ...requestConfig };

  // headers 需要深度合并
  const method = (config.method || "GET").toLowerCase();
  config.headers = {
    ...defaults.headers?.common,
    ...defaults.headers?.[method],
    ...instanceConfig?.headers,
    ...requestConfig?.headers,
  };

  // 转换器合并（数组拼接）
  if (instanceConfig?.transformRequest) {
    config.transformRequest = [].concat(defaults.transformRequest || [], instanceConfig.transformRequest);
  }
  if (instanceConfig?.transformResponse) {
    config.transformResponse = [].concat(defaults.transformResponse || [], instanceConfig.transformResponse);
  }

  return config;
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、URL 构建
// ═══════════════════════════════════════════════════════════════════════════
//
// 处理 baseURL 拼接 + params 序列化
// axios.get('/users', { params: { page: 1, size: 10 } })
// → GET /users?page=1&size=10

function buildURL(url, params, baseURL) {
  // 拼接 baseURL
  if (baseURL && !url.startsWith("http")) {
    url = baseURL.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
  }

  // 序列化 params
  if (params && typeof params === "object") {
    const parts = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        // params: { ids: [1, 2, 3] } → ids[]=1&ids[]=2&ids[]=3
        value.forEach((v) => parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(v)}`));
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    }
    if (parts.length) {
      const separator = url.includes("?") ? "&" : "?";
      url += separator + parts.join("&");
    }
  }

  return url;
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、转换器
// ═══════════════════════════════════════════════════════════════════════════
//
// transformRequest：发送前处理 data（JSON.stringify、FormData 等）
// transformResponse：收到后处理 data（JSON.parse、数据脱壳等）

function applyTransformers(data, headers, transformers) {
  if (!transformers) return data;
  let result = data;
  for (const fn of transformers) {
    result = fn(result, headers);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、CancelToken — 取消请求
// ═══════════════════════════════════════════════════════════════════════════
//
// 两种取消方式（axios 都支持）：
//
// 方式 1：CancelToken（axios 早期方案，已过时但需要了解）
//   const source = CancelToken.source();
//   request.get('/api', { cancelToken: source.token });
//   source.cancel('用户取消了');
//
// 方式 2：AbortController（现代标准方案）
//   const controller = new AbortController();
//   request.get('/api', { signal: controller.signal });
//   controller.abort();

class CancelToken {
  constructor(executor) {
    let resolvePromise;
    this.promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    this.reason = null;

    executor((message) => {
      if (this.reason) return; // 防止重复取消
      this.reason = new CancelError(message || "Request cancelled");
      resolvePromise(this.reason);
    });
  }

  /**
   * 便捷工厂方法
   * 返回 { token, cancel } 对
   */
  static source() {
    let cancel;
    const token = new CancelToken((c) => { cancel = c; });
    return { token, cancel };
  }

  throwIfRequested() {
    if (this.reason) throw this.reason;
  }
}

class CancelError extends Error {
  constructor(message) {
    super(message);
    this.name = "CancelError";
    this.__CANCEL__ = true;
  }
}

function isCancel(error) {
  return error && error.__CANCEL__ === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 六、适配器 — 实际发送请求
// ═══════════════════════════════════════════════════════════════════════════
//
// axios 的适配器模式：
//   浏览器 → XMLHttpRequest adapter
//   Node.js → http/https adapter
//   测试 → mock adapter
//
// 这里模拟一个适配器，不真正发网络请求，用于演示完整流程

function mockAdapter(config) {
  return new Promise((resolve, reject) => {
    // 模拟网络延迟
    const delay = config._mockDelay || 50;

    // 超时处理
    let timeoutId;
    let cancelledByTimeout = false;

    if (config.timeout > 0) {
      timeoutId = setTimeout(() => {
        cancelledByTimeout = true;
        reject(createError("Timeout of " + config.timeout + "ms exceeded", config, "ECONNABORTED"));
      }, config.timeout);
    }

    // 取消请求支持（CancelToken）
    if (config.cancelToken) {
      config.cancelToken.promise.then((reason) => {
        if (!cancelledByTimeout) {
          clearTimeout(timeoutId);
          reject(reason);
        }
      });
    }

    // 取消请求支持（AbortController signal）
    if (config.signal) {
      if (config.signal.aborted) {
        reject(new CancelError("Request aborted"));
        return;
      }
      config.signal.addEventListener("abort", () => {
        if (!cancelledByTimeout) {
          clearTimeout(timeoutId);
          reject(new CancelError("Request aborted"));
        }
      });
    }

    // 模拟响应
    setTimeout(() => {
      if (cancelledByTimeout) return;
      clearTimeout(timeoutId);

      // 模拟不同 URL 的响应
      const mockResponses = {
        "/api/users": { status: 200, data: JSON.stringify({ code: 0, data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }], message: "ok" }) },
        "/api/user/1": { status: 200, data: JSON.stringify({ code: 0, data: { id: 1, name: "Alice", email: "alice@test.com" }, message: "ok" }) },
        "/api/login": { status: 200, data: JSON.stringify({ code: 0, data: { token: "jwt-token-xxx" }, message: "ok" }) },
        "/api/error": { status: 500, data: JSON.stringify({ code: -1, message: "Internal Server Error" }) },
        "/api/unauthorized": { status: 401, data: JSON.stringify({ code: 401, message: "Token expired" }) },
        "/api/slow": { status: 200, data: JSON.stringify({ code: 0, data: "slow response" }) },
        "/api/retry-test": { status: config._retryAttempt < 2 ? 500 : 200, data: config._retryAttempt < 2 ? JSON.stringify({ error: "temporary" }) : JSON.stringify({ code: 0, data: "success after retry" }) },
      };

      const urlPath = (config.url || "").replace(/\?.*$/, ""); // 去掉 query
      const mock = mockResponses[urlPath] || { status: 200, data: JSON.stringify({ code: 0, data: null }) };

      const response = {
        data: mock.data,
        status: mock.status,
        statusText: mock.status === 200 ? "OK" : "Error",
        headers: { "content-type": "application/json" },
        config,
      };

      if (config.validateStatus(response.status)) {
        resolve(response);
      } else {
        reject(createError(
          `Request failed with status code ${response.status}`,
          config, null, response
        ));
      }
    }, delay);
  });
}

function createError(message, config, code, response) {
  const error = new Error(message);
  error.config = config;
  error.code = code;
  error.response = response;
  error.isAxiosError = true;
  return error;
}

// ═══════════════════════════════════════════════════════════════════════════
// 七、请求重试
// ═══════════════════════════════════════════════════════════════════════════
//
// 重试策略：
//   1. 只重试幂等请求（GET / PUT / DELETE），POST 默认不重试
//   2. 只重试网络错误和 5xx，不重试 4xx（客户端错误无意义重试）
//   3. 指数退避：每次重试间隔翻倍（100ms → 200ms → 400ms）
//   4. 设置最大重试次数

function retryRequest(requestFn, config) {
  const retryConfig = config.retry || {};
  const maxRetries = retryConfig.count || 0;
  const retryDelay = retryConfig.delay || 100;
  const retryCondition = retryConfig.condition || defaultRetryCondition;

  let attempt = 0;

  function attemptRequest() {
    config._retryAttempt = attempt;
    return requestFn(config).catch((error) => {
      attempt++;
      if (attempt <= maxRetries && retryCondition(error)) {
        // 指数退避
        const delay = retryDelay * Math.pow(2, attempt - 1);
        console.log(`    [retry] 第 ${attempt}/${maxRetries} 次重试，${delay}ms 后...`);
        return new Promise((resolve) => setTimeout(resolve, delay))
          .then(() => attemptRequest());
      }
      throw error;
    });
  }

  return attemptRequest();
}

function defaultRetryCondition(error) {
  // 网络错误 或 5xx 或 超时
  if (isCancel(error)) return false;
  if (!error.response) return true; // 网络错误
  const status = error.response?.status;
  return status >= 500 || error.code === "ECONNABORTED";
}

// ═══════════════════════════════════════════════════════════════════════════
// 八、并发控制
// ═══════════════════════════════════════════════════════════════════════════
//
// 限制同时发出的请求数量（避免浏览器 6 连接限制、服务端压力）
// 典型场景：批量上传文件、批量请求资源

class RequestScheduler {
  constructor(maxConcurrent = 6) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  /**
   * 提交一个请求任务
   * @param {Function} fn - 返回 Promise 的函数
   * @returns {Promise}
   */
  add(fn) {
    return new Promise((resolve, reject) => {
      const task = () => {
        this.running++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            this._next();
          });
      };

      if (this.running < this.maxConcurrent) {
        task();
      } else {
        this.queue.push(task);
      }
    });
  }

  _next() {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const task = this.queue.shift();
      task();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 九、请求缓存
// ═══════════════════════════════════════════════════════════════════════════
//
// 对 GET 请求缓存结果（幂等性）
// 缓存 key = method + url + params 序列化
// 支持 TTL（缓存有效期）和手动清除

class RequestCache {
  constructor(ttl = 5000) {
    this.cache = new Map();
    this.ttl = ttl; // 默认 5 秒
  }

  _generateKey(config) {
    const { method, url, params } = config;
    return `${(method || "GET").toUpperCase()}:${url}:${JSON.stringify(params || {})}`;
  }

  get(config) {
    const key = this._generateKey(config);
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(config, data) {
    const key = this._generateKey(config);
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear() {
    this.cache.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 十、请求去重（防抖）
// ═══════════════════════════════════════════════════════════════════════════
//
// 同一时间对同一个接口的重复请求，只发一次，多个调用者共享同一个 Promise
// 场景：多个组件同时请求用户信息、快速连续点击提交

class RequestDedup {
  constructor() {
    this.pending = new Map(); // key → Promise
  }

  _generateKey(config) {
    return `${(config.method || "GET").toUpperCase()}:${config.url}:${JSON.stringify(config.params || {})}:${JSON.stringify(config.data || {})}`;
  }

  /**
   * 包装请求函数，相同请求复用 Promise
   */
  wrap(config, requestFn) {
    const key = this._generateKey(config);

    if (this.pending.has(key)) {
      console.log("    [dedup] 复用已有请求:", key.slice(0, 50));
      return this.pending.get(key);
    }

    const promise = requestFn(config).finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 十一、Axios 主类
// ═══════════════════════════════════════════════════════════════════════════
//
// 核心设计：
//   1. 实例有自己的 defaults 和拦截器（互不影响）
//   2. request() 是入口：合并配置 → 构建拦截器链 → 串联执行
//   3. get/post/put/delete 是 request 的快捷方式

class Axios {
  constructor(instanceConfig = {}) {
    this.defaults = { ...DEFAULTS, ...instanceConfig };
    this.interceptors = {
      request: new InterceptorManager(),
      response: new InterceptorManager(),
    };
    this._cache = instanceConfig.cache ? new RequestCache(instanceConfig.cacheTTL) : null;
    this._dedup = instanceConfig.dedup ? new RequestDedup() : null;
  }

  /**
   * 核心请求方法
   *
   * 执行流程：
   *   1. 合并配置
   *   2. 构建 Promise 链：[请求拦截器..., dispatchRequest, 响应拦截器...]
   *   3. 依次执行链中的每一环
   */
  request(configOrUrl, config) {
    // 支持 request('/api', { method: 'GET' }) 和 request({ url: '/api' }) 两种调用
    if (typeof configOrUrl === "string") {
      config = config || {};
      config.url = configOrUrl;
    } else {
      config = configOrUrl || {};
    }

    // 合并配置
    const mergedConfig = mergeConfig(DEFAULTS, this.defaults, config);

    // 构建 URL
    mergedConfig.url = buildURL(mergedConfig.url, mergedConfig.params, mergedConfig.baseURL);

    // ── 构建拦截器链 ──
    //
    // 链结构：[req拦截器n, ..., req拦截器1, dispatchRequest, res拦截器1, ..., res拦截器n]
    //
    // 为什么请求拦截器是 unshift（后加的先执行）？
    //   场景：先注册通用 token 拦截器，后注册特殊签名拦截器
    //   签名可能依赖 token → 签名拦截器应该后执行 → 后注册的先执行

    const chain = [{ fulfilled: (c) => this._dispatchRequest(c), rejected: undefined }];

    // 请求拦截器 → 放在链头部（unshift → 后添加的先执行）
    this.interceptors.request.forEach((interceptor) => {
      chain.unshift(interceptor);
    });

    // 响应拦截器 → 放在链尾部（push → 先添加的先执行）
    this.interceptors.response.forEach((interceptor) => {
      chain.push(interceptor);
    });

    // 用 Promise 串联整条链
    let promise = Promise.resolve(mergedConfig);
    for (const { fulfilled, rejected } of chain) {
      promise = promise.then(fulfilled, rejected);
    }

    return promise;
  }

  /**
   * 内部分发请求
   * 处理转换器 + 缓存 + 去重 + 重试 + 适配器调用
   */
  _dispatchRequest(config) {
    // 取消检查
    if (config.cancelToken) config.cancelToken.throwIfRequested();

    // 请求转换器
    config.data = applyTransformers(config.data, config.headers, config.transformRequest);

    // 缓存（仅 GET）
    if (this._cache && config.method.toUpperCase() === "GET") {
      const cached = this._cache.get(config);
      if (cached) {
        console.log("    [cache] 命中缓存:", config.url);
        return Promise.resolve(cached);
      }
    }

    // 选择适配器
    const adapter = config.adapter || mockAdapter;

    // 实际请求（可能经过去重 + 重试）
    let requestPromise;

    const doRequest = (cfg) => adapter(cfg);

    // 去重包装
    if (this._dedup) {
      requestPromise = this._dedup.wrap(config, (cfg) => {
        return config.retry ? retryRequest(doRequest, cfg) : doRequest(cfg);
      });
    } else if (config.retry) {
      requestPromise = retryRequest(doRequest, config);
    } else {
      requestPromise = doRequest(config);
    }

    return requestPromise.then((response) => {
      // 响应转换器
      response.data = applyTransformers(response.data, response.headers, config.transformResponse);

      // 写缓存
      if (this._cache && config.method.toUpperCase() === "GET") {
        this._cache.set(config, response);
      }

      return response;
    });
  }

  // ── 快捷方法 ──
  // 无 body 的方法
  get(url, config) { return this.request({ ...config, url, method: "GET" }); }
  delete(url, config) { return this.request({ ...config, url, method: "DELETE" }); }
  head(url, config) { return this.request({ ...config, url, method: "HEAD" }); }

  // 有 body 的方法
  post(url, data, config) { return this.request({ ...config, url, data, method: "POST" }); }
  put(url, data, config) { return this.request({ ...config, url, data, method: "PUT" }); }
  patch(url, data, config) { return this.request({ ...config, url, data, method: "PATCH" }); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 十二、create — 创建实例 + 默认实例
// ═══════════════════════════════════════════════════════════════════════════
//
// axios 的使用方式：
//   import axios from 'axios';            // 默认实例
//   axios.get('/api/users');
//
//   const api = axios.create({ baseURL }); // 自定义实例
//   api.get('/users');
//
// 关键：axios 既是函数又是对象（可以 axios('/api') 也可以 axios.get('/api')）

function createInstance(config) {
  const instance = new Axios(config);

  // 让 request 绑定到实例（这样可以 instance('/api') 直接调用）
  const request = instance.request.bind(instance);

  // 把实例的方法和属性复制到 request 函数上
  // 这就是为什么 axios 既是函数又是对象
  Object.getOwnPropertyNames(Axios.prototype).forEach((method) => {
    if (method !== "constructor") {
      request[method] = instance[method].bind(instance);
    }
  });
  request.interceptors = instance.interceptors;
  request.defaults = instance.defaults;

  // 暴露 create 方法
  request.create = (cfg) => createInstance({ ...config, ...cfg });

  // 暴露工具方法
  request.isCancel = isCancel;
  request.CancelToken = CancelToken;
  request.all = Promise.all.bind(Promise);
  request.spread = (fn) => (arr) => fn(...arr);

  return request;
}

// 默认实例
const request = createInstance({});

// ═══════════════════════════════════════════════════════════════════════════
// 十三、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini Request 请求库演示 ===\n");

(async () => {
  // ── 测试 1：基础 GET 请求 ──

  console.log("【测试 1】基础 GET 请求\n");

  const res1 = await request.get("/api/users");
  console.log("  GET /api/users:");
  console.log("  status:", res1.status);
  console.log("  data:", JSON.stringify(res1.data));

  // ── 测试 2：POST 请求 + 自动 JSON 序列化 ──

  console.log("\n\n【测试 2】POST 请求 + JSON 序列化\n");

  const res2 = await request.post("/api/login", {
    username: "admin",
    password: "123456",
  });
  console.log("  POST /api/login:");
  console.log("  data:", JSON.stringify(res2.data));

  // ── 测试 3：params 序列化 ──

  console.log("\n\n【测试 3】URL params 序列化\n");

  const url3 = buildURL("/api/users", { page: 1, size: 10, tags: ["a", "b"] });
  console.log("  buildURL('/api/users', { page: 1, size: 10, tags: ['a','b'] })");
  console.log("  →", url3);

  const url3b = buildURL("/users", null, "https://api.example.com/v1/");
  console.log("\n  buildURL('/users', null, 'https://api.example.com/v1/')");
  console.log("  →", url3b);

  // ── 测试 4：请求拦截器 ──

  console.log("\n\n【测试 4】请求拦截器（添加 token）\n");

  const api = createInstance({ baseURL: "" });

  // 注册请求拦截器：自动添加 Authorization
  api.interceptors.request.use((config) => {
    const token = "Bearer my-jwt-token";
    config.headers = { ...config.headers, Authorization: token };
    console.log("  [请求拦截器] 添加 token:", token.slice(0, 20) + "...");
    return config;
  });

  // 注册响应拦截器：数据脱壳（去掉 { code, data, message } 的外壳）
  api.interceptors.response.use(
    (response) => {
      const body = response.data;
      if (body && body.code === 0) {
        console.log("  [响应拦截器] 数据脱壳: { code, data, message } → data");
        response.data = body.data;
      }
      return response;
    },
    (error) => {
      if (error.response?.status === 401) {
        console.log("  [响应拦截器] 401 → 跳转登录页");
      }
      return Promise.reject(error);
    }
  );

  const res4 = await api.get("/api/users");
  console.log("  最终 data:", JSON.stringify(res4.data));
  console.log("  (已脱壳，直接拿到数组)");

  // ── 测试 5：响应拦截器 — 错误处理 ──

  console.log("\n\n【测试 5】响应拦截器 — 统一错误处理\n");

  try {
    await api.get("/api/unauthorized");
  } catch (err) {
    console.log("  捕获错误:", err.message);
    console.log("  status:", err.response?.status);
  }

  // ── 测试 6：取消请求（CancelToken）──

  console.log("\n\n【测试 6】取消请求（CancelToken）\n");

  const source = CancelToken.source();

  const cancelPromise = request.get("/api/slow", {
    cancelToken: source.token,
    _mockDelay: 200,
  });

  // 50ms 后取消
  setTimeout(() => source.cancel("用户手动取消"), 30);

  try {
    await cancelPromise;
  } catch (err) {
    console.log("  isCancel:", isCancel(err));
    console.log("  message:", err.message);
  }

  // ── 测试 7：超时控制 ──

  console.log("\n\n【测试 7】超时控制\n");

  try {
    await request.get("/api/slow", { timeout: 10, _mockDelay: 200 });
  } catch (err) {
    console.log("  超时错误:", err.message);
    console.log("  code:", err.code);
  }

  // ── 测试 8：请求重试 ──

  console.log("\n\n【测试 8】请求重试（指数退避）\n");

  try {
    const res8 = await request.get("/api/retry-test", {
      retry: { count: 3, delay: 50 },
      _mockDelay: 10,
    });
    console.log("  最终成功:", JSON.stringify(res8.data));
  } catch (err) {
    console.log("  最终失败:", err.message);
  }

  // ── 测试 9：创建独立实例 ──

  console.log("\n\n【测试 9】创建独立实例\n");

  const apiV1 = request.create({ baseURL: "https://api.example.com/v1" });
  const apiV2 = request.create({ baseURL: "https://api.example.com/v2" });

  console.log("  apiV1 baseURL:", apiV1.defaults.baseURL);
  console.log("  apiV2 baseURL:", apiV2.defaults.baseURL);
  console.log("  (各实例独立配置、独立拦截器)");

  // ── 测试 10：拦截器的 eject ──

  console.log("\n\n【测试 10】移除拦截器（eject）\n");

  const tempApi = createInstance({});
  const interceptorId = tempApi.interceptors.request.use((config) => {
    console.log("  [temp 拦截器] 执行了");
    return config;
  });

  console.log("  第一次请求（拦截器生效）:");
  await tempApi.get("/api/users");

  tempApi.interceptors.request.eject(interceptorId);
  console.log("\n  eject 后第二次请求（拦截器已移除）:");
  await tempApi.get("/api/users");
  console.log("  (无拦截器输出)");

  // ── 测试 11：并发控制 ──

  console.log("\n\n【测试 11】并发控制（maxConcurrent=2）\n");

  const scheduler = new RequestScheduler(2);
  const startTime = Date.now();
  const tasks = [1, 2, 3, 4, 5].map((i) =>
    scheduler.add(() =>
      request.get("/api/users", { _mockDelay: 50 }).then(() => {
        const elapsed = Date.now() - startTime;
        console.log(`    任务 ${i} 完成 (${elapsed}ms)`);
      })
    )
  );
  await Promise.all(tasks);
  console.log("  5 个任务，最大并发 2，分批执行");

  // ── 测试 12：请求缓存 ──

  console.log("\n\n【测试 12】请求缓存\n");

  const cachedApi = createInstance({ cache: true, cacheTTL: 3000 });

  console.log("  第一次 GET /api/users（无缓存，发起请求）:");
  await cachedApi.get("/api/users");

  console.log("  第二次 GET /api/users（命中缓存）:");
  await cachedApi.get("/api/users");

  // ── 测试 13：请求去重 ──

  console.log("\n\n【测试 13】请求去重\n");

  const dedupApi = createInstance({ dedup: true });

  console.log("  同时发起 3 个相同请求:");
  const [r1, r2, r3] = await Promise.all([
    dedupApi.get("/api/users", { _mockDelay: 50 }),
    dedupApi.get("/api/users", { _mockDelay: 50 }),
    dedupApi.get("/api/users", { _mockDelay: 50 }),
  ]);
  console.log("  三个结果是否相同:", r1 === r2 && r2 === r3);
  console.log("  (实际只发了 1 次请求)");

  // ── 测试 14：完整的业务封装示例 ──

  console.log("\n\n【测试 14】业务封装示例（综合）\n");

  console.log("  实际项目中的封装方式:");
  console.log(`
    // request.js
    const api = request.create({
      baseURL: 'https://api.example.com/v1',
      timeout: 10000,
      cache: true,
    });

    // 请求拦截器：添加 token
    api.interceptors.request.use(config => {
      const token = localStorage.getItem('token');
      if (token) config.headers.Authorization = 'Bearer ' + token;
      return config;
    });

    // 响应拦截器：统一错误处理
    api.interceptors.response.use(
      response => response.data?.data ?? response.data,
      error => {
        if (error.response?.status === 401) router.push('/login');
        if (error.response?.status === 403) message.error('无权限');
        if (error.response?.status >= 500) message.error('服务器错误');
        return Promise.reject(error);
      }
    );

    // API 模块
    export const userApi = {
      list: (params) => api.get('/users', { params }),
      detail: (id) => api.get('/users/' + id),
      create: (data) => api.post('/users', data),
      update: (id, data) => api.put('/users/' + id, data),
      delete: (id) => api.delete('/users/' + id),
    };
  `);

  console.log("\n\n=== 面试要点 ===");
  console.log("1. axios 核心 = 拦截器链(Promise.then串联) + 适配器模式(xhr/fetch/http)");
  console.log("2. 拦截器执行顺序：请求拦截器后加先执行(unshift)，响应拦截器先加先执行(push)");
  console.log("3. 配置合并三层优先级：默认 < 实例级 < 请求级，headers 深度合并");
  console.log("4. 取消请求：CancelToken(旧) / AbortController(新)，原理都是通知适配器中止");
  console.log("5. 转换器：transformRequest(JSON.stringify) + transformResponse(JSON.parse)");
  console.log("6. 请求重试：只重试幂等+5xx/网络错误 + 指数退避(delay * 2^n)");
  console.log("7. 并发控制：任务队列 + running 计数 + 完成后自动 dequeue");
  console.log("8. 请求去重：相同请求共享 Promise，防止重复请求（Map<key, Promise>）");
  console.log("9. 缓存：GET 幂等请求缓存结果 + TTL 过期策略");
  console.log("10. create 返回函数+对象：bind(instance.request) + 复制原型方法到函数上");
})();
