/**
 * Mini React Router 实现
 *
 * ═══════════════════════════════════════════════════════
 *  核心原理
 * ═══════════════════════════════════════════════════════
 *
 * React Router 本质上做三件事：
 *   1. 监听 URL 变化（popstate / hashchange）
 *   2. 匹配当前路径对应的路由规则
 *   3. 渲染匹配到的组件
 *
 * 两种路由模式：
 *   - History 模式：使用 history.pushState + popstate 事件
 *     URL: /user/profile（好看，需要服务端配合）
 *   - Hash 模式：使用 location.hash + hashchange 事件
 *     URL: /#/user/profile（不需要服务端配合）
 *
 * ═══════════════════════════════════════════════════════
 *  React Router 的组件模型
 * ═══════════════════════════════════════════════════════
 *
 *  <BrowserRouter>         ← 提供 history 上下文
 *    <Routes>              ← 匹配路由
 *      <Route path="/" element={<Home/>} />
 *      <Route path="/about" element={<About/>} />
 *    </Routes>
 *  </BrowserRouter>
 *
 *  <Link to="/about">      ← 声明式导航（不刷新页面）
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. createBrowserHistory / createHashHistory — 两种路由模式
 *  2. Router — 监听 URL 变化，通过 Context 传递 location
 *  3. Route — 匹配 path，渲染对应组件
 *  4. Routes — 遍历子 Route，只渲染第一个匹配的
 *  5. Link — 声明式导航，阻止默认跳转，调用 history.push
 *  6. useNavigate / useParams / useLocation — 常用 Hook
 *  7. 支持动态路由参数 /user/:id
 *
 * 运行方式：浏览器环境（需配合 React），本文件为原理演示
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、History 抽象层
// ═══════════════════════════════════════════════════════════════════════════
//
// 为什么要抽象？
//   BrowserRouter 和 HashRouter 的 URL 操作方式不同，
//   但上层组件（Route/Link）不关心用的是哪种模式。
//   所以抽一层统一接口：{ push, replace, listen, location }

/**
 * BrowserHistory — 基于 HTML5 History API
 *
 * 关键 API：
 *   history.pushState(state, '', url)  — 修改 URL，不刷新页面
 *   window.onpopstate                  — 浏览器前进/后退时触发
 *   注意：pushState 本身不触发 popstate，需要手动通知监听者
 */
function createBrowserHistory() {
  const listeners = [];

  function notify() {
    const location = getLocation();
    listeners.forEach((fn) => fn(location));
  }

  function getLocation() {
    return {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    };
  }

  function push(to) {
    window.history.pushState(null, "", to);
    notify(); // pushState 不触发 popstate，手动通知
  }

  function replace(to) {
    window.history.replaceState(null, "", to);
    notify();
  }

  function listen(fn) {
    listeners.push(fn);
    // 监听浏览器前进/后退
    const handler = () => fn(getLocation());
    window.addEventListener("popstate", handler);
    // 返回取消订阅函数
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx > -1) listeners.splice(idx, 1);
      window.removeEventListener("popstate", handler);
    };
  }

  return { push, replace, listen, get location() { return getLocation(); } };
}

/**
 * HashHistory — 基于 URL hash
 *
 * 关键 API：
 *   location.hash = '#/about'    — 修改 hash
 *   window.onhashchange           — hash 变化时触发（包括手动修改和前进后退）
 */
function createHashHistory() {
  const listeners = [];

  function getLocation() {
    const hash = window.location.hash.slice(1) || "/"; // 去掉 #
    return {
      pathname: hash,
      search: "",
      hash: window.location.hash,
    };
  }

  function notify() {
    const location = getLocation();
    listeners.forEach((fn) => fn(location));
  }

  function push(to) {
    window.location.hash = "#" + to;
    // hashchange 事件会自动触发，但为了同步性也手动 notify
  }

  function replace(to) {
    // replaceState 也可以用于 hash 模式
    const url = window.location.pathname + window.location.search + "#" + to;
    window.history.replaceState(null, "", url);
    notify();
  }

  function listen(fn) {
    listeners.push(fn);
    const handler = () => fn(getLocation());
    window.addEventListener("hashchange", handler);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx > -1) listeners.splice(idx, 1);
      window.removeEventListener("hashchange", handler);
    };
  }

  return { push, replace, listen, get location() { return getLocation(); } };
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、路径匹配
// ═══════════════════════════════════════════════════════════════════════════
//
// 支持：
//   /about           — 精确匹配
//   /user/:id        — 动态参数，匹配 /user/123 → params = { id: '123' }
//   /user/:id/post/:postId — 多个参数
//   *                — 通配符（404 页面）
//
// 真实 React Router v6 用的是 path-to-regexp 库的简化版
// 这里手写一个够面试用的版本

function matchPath(pattern, pathname) {
  // 通配符匹配所有路径
  if (pattern === "*") {
    return { params: {}, matched: true };
  }

  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  // 长度不一致则不匹配（不考虑嵌套路由的情况）
  if (patternParts.length !== pathParts.length) {
    return { params: {}, matched: false };
  }

  const params = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i];
    const val = pathParts[i];

    if (pat.startsWith(":")) {
      // 动态参数：:id → 提取值
      params[pat.slice(1)] = val;
    } else if (pat !== val) {
      // 静态部分不匹配
      return { params: {}, matched: false };
    }
  }

  return { params, matched: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、核心组件（伪 React 实现，展示原理）
// ═══════════════════════════════════════════════════════════════════════════
//
// 真实 React Router 通过 React.createContext 传递 history 和 location
// 这里用全局变量模拟 Context，专注于展示路由逻辑

// ── 模拟 React Context ──────────────────────────────────────────────────
let _routerContext = {
  history: null,
  location: null,
  params: {},
};

/**
 * Router（对应 BrowserRouter / HashRouter）
 *
 * 职责：
 *   1. 创建 history 实例
 *   2. 监听 URL 变化
 *   3. URL 变化时触发重渲染（通过 setState / forceUpdate）
 *   4. 通过 Context 把 history + location 传给子组件
 */
function Router({ history, children }) {
  // 初始化 context
  _routerContext.history = history;
  _routerContext.location = history.location;

  // 监听路由变化，更新 context
  // 真实实现：在 useEffect 中 listen，变化时 setState 触发重渲染
  history.listen((location) => {
    _routerContext.location = location;
    // 真实 React 中这里会 setState 触发组件树重渲染
    // setState({ location }) → 子组件拿到新 location → 重新匹配路由
  });

  return children;
}

// 便捷包装
function BrowserRouter({ children }) {
  return Router({ history: createBrowserHistory(), children });
}

function HashRouter({ children }) {
  return Router({ history: createHashHistory(), children });
}

/**
 * Route
 *
 * 职责：声明一条路由规则
 * 本身不渲染，只是数据载体，真正的匹配逻辑在 Routes 中
 */
function Route({ path, element }) {
  return { path, element, isRoute: true };
}

/**
 * Routes（对应 v6 的 <Routes>，v5 叫 <Switch>）
 *
 * 职责：
 *   1. 遍历所有子 Route
 *   2. 用当前 pathname 匹配每个 Route 的 path
 *   3. 只渲染第一个匹配的（排他性匹配）
 *   4. 都不匹配 → 渲染 path="*" 的 Route（如果有）
 *
 * v5 Switch vs v6 Routes 的区别：
 *   v5 Switch：按顺序匹配，第一个匹配就停
 *   v6 Routes：所有路由一起比较，选"最具体"的（最长前缀）
 *   这里实现 v5 的简单版
 */
function Routes({ children }) {
  const pathname = _routerContext.location.pathname;
  let fallback = null;

  for (const route of children) {
    if (!route.isRoute) continue;

    if (route.path === "*") {
      fallback = route.element;
      continue;
    }

    const result = matchPath(route.path, pathname);
    if (result.matched) {
      _routerContext.params = result.params;
      return route.element;
    }
  }

  // 没有匹配 → 渲染通配符路由（404）
  return fallback || null;
}

/**
 * Link
 *
 * 职责：
 *   1. 渲染一个 <a> 标签
 *   2. 拦截点击事件（preventDefault）
 *   3. 调用 history.push 更新 URL（不刷新页面）
 *
 * 为什么不直接用 <a href>？
 *   <a href="/about"> 会触发浏览器全量刷新
 *   Link 通过 pushState 只更新 URL，页面不刷新，React 重新渲染匹配的组件
 */
function Link({ to, children }) {
  // 返回渲染描述（伪代码，真实中返回 JSX）
  return {
    type: "a",
    props: {
      href: to,
      onClick: (e) => {
        e.preventDefault();  // 阻止默认的页面跳转
        _routerContext.history.push(to);
      },
      children,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 四、常用 Hooks
// ═══════════════════════════════════════════════════════════════════════════

// 获取 history.push / history.replace
// 用法：const navigate = useNavigate(); navigate('/about');
function useNavigate() {
  const { history } = _routerContext;
  return (to, { replace = false } = {}) => {
    if (replace) {
      history.replace(to);
    } else {
      history.push(to);
    }
  };
}

// 获取当前路由的动态参数
// 用法：const { id } = useParams();  （路由为 /user/:id）
function useParams() {
  return _routerContext.params;
}

// 获取当前 location 对象
// 用法：const { pathname, search } = useLocation();
function useLocation() {
  return _routerContext.location;
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

// ── 测试路径匹配 ──

console.log("=== Mini React Router 演示 ===\n");

console.log("【路径匹配测试】\n");

const testCases = [
  { pattern: "/about", pathname: "/about", expected: true },
  { pattern: "/about", pathname: "/home", expected: false },
  { pattern: "/user/:id", pathname: "/user/123", expected: true },
  { pattern: "/user/:id", pathname: "/user/123/extra", expected: false },
  { pattern: "/post/:id/comment/:cid", pathname: "/post/42/comment/7", expected: true },
  { pattern: "*", pathname: "/anything/goes/here", expected: true },
];

testCases.forEach(({ pattern, pathname, expected }) => {
  const result = matchPath(pattern, pathname);
  const status = result.matched === expected ? "PASS" : "FAIL";
  const params = Object.keys(result.params).length
    ? ` params=${JSON.stringify(result.params)}`
    : "";
  console.log(`  [${status}] matchPath("${pattern}", "${pathname}") → ${result.matched}${params}`);
});

// ── 测试 Routes 匹配 ──

console.log("\n【Routes 匹配测试】\n");

// 模拟浏览器环境
_routerContext.history = {
  push: (to) => console.log(`  → navigate to: ${to}`),
  replace: (to) => console.log(`  → replace to: ${to}`),
  location: { pathname: "/user/456", search: "", hash: "" },
  listen: () => () => {},
};
_routerContext.location = _routerContext.history.location;

const routes = [
  Route({ path: "/", element: "HomePage" }),
  Route({ path: "/about", element: "AboutPage" }),
  Route({ path: "/user/:id", element: "UserPage" }),
  Route({ path: "*", element: "NotFound" }),
];

const matched = Routes({ children: routes });
console.log(`  当前路径: ${_routerContext.location.pathname}`);
console.log(`  匹配组件: ${matched}`);
console.log(`  路由参数: ${JSON.stringify(_routerContext.params)}`);

// 模拟导航
_routerContext.location = { pathname: "/nonexistent", search: "", hash: "" };
const matched2 = Routes({ children: routes });
console.log(`\n  当前路径: ${_routerContext.location.pathname}`);
console.log(`  匹配组件: ${matched2} (通配符路由)`);

// ── 测试 Link ──

console.log("\n【Link 原理】\n");
const link = Link({ to: "/about", children: "Go to About" });
console.log("  Link 渲染为 <a> 标签:");
console.log(`    href="${link.props.href}"`);
console.log("    onClick: e.preventDefault() + history.push('/about')");
console.log("  点击效果（不会整页刷新）:");
link.props.onClick({ preventDefault: () => {} });

// ── 测试 Hooks ──

console.log("\n【Hooks 测试】\n");
_routerContext.location = { pathname: "/user/789", search: "?tab=posts", hash: "" };
_routerContext.params = { id: "789" };

const navigate = useNavigate();
const params = useParams();
const location = useLocation();

console.log(`  useLocation() → ${JSON.stringify(location)}`);
console.log(`  useParams()   → ${JSON.stringify(params)}`);
console.log("  useNavigate()('/new-page'):");
navigate("/new-page");

console.log("\n\n=== 面试要点 ===");
console.log("1. Router 监听 URL 变化（popstate/hashchange），变化时 setState 触发重渲染");
console.log("2. Routes 遍历子 Route，用当前 pathname 匹配 path，只渲染第一个匹配的");
console.log("3. Link 渲染 <a>，拦截 click 调用 history.pushState，不刷新页面");
console.log("4. 动态路由 /user/:id 通过 split + 逐段比较实现匹配和参数提取");
console.log("5. useNavigate/useParams/useLocation 本质是从 Context 中读取数据");
console.log("6. pushState 不触发 popstate! 只有浏览器前进/后退才触发，所以 push 后要手动 notify");
