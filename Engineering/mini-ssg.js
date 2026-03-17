/**
 * Mini SSG（Static Site Generation）静态站点生成
 *
 * ═══════════════════════════════════════════════════════
 *  SSG 的核心原理
 * ═══════════════════════════════════════════════════════
 *
 * SSG = 构建时预渲染
 *   1. 在 build 时（Node.js 环境）执行 React/Vue 组件
 *   2. 调用 renderToString 生成 HTML
 *   3. 输出静态 HTML 文件 → 部署到 CDN
 *   4. 客户端加载后 hydrate → 变成 SPA
 *
 * 对比 SSR：
 *   SSR：每次请求时 → 服务端渲染 → 返回 HTML（需要 Node.js 服务器）
 *   SSG：构建时 → 预渲染所有页面 → 输出 HTML（只需静态托管）
 *
 * Next.js 的三种渲染模式：
 *   getStaticProps → SSG（构建时获取数据 + 渲染）
 *   getServerSideProps → SSR（请求时获取数据 + 渲染）
 *   无数据获取 → 自动 SSG
 *
 * ISR（Incremental Static Regeneration）：
 *   SSG + revalidate → 在请求时检查是否过期 → 过期则后台重新生成
 *   兼具 SSG 的性能和 SSR 的数据新鲜度
 *
 * ═══════════════════════════════════════════════════════
 *  本文件实现
 * ═══════════════════════════════════════════════════════
 *
 *  1. renderToString — 将组件树渲染为 HTML 字符串
 *  2. 路由系统 — 基于文件系统的路由（pages/ → routes）
 *  3. 数据获取 — getStaticProps / getStaticPaths
 *  4. SSG 构建器 — 遍历路由 → 获取数据 → 渲染 → 输出
 *  5. ISR 模拟 — 按需重新生成
 *
 * 运行方式：node Engineering/mini-ssg.js
 */

// ═══════════════════════════════════════════════════════════════════════════
// 一、renderToString — 组件渲染为 HTML
// ═══════════════════════════════════════════════════════════════════════════
//
// React.renderToString 的简化版：
//   接收虚拟 DOM 树 → 递归拼接 HTML 字符串
//
// 虚拟 DOM 结构：
//   { type: 'div', props: { className: 'app', children: [...] } }

function renderToString(vnode) {
  if (vnode === null || vnode === undefined) return "";

  // 文本节点
  if (typeof vnode === "string" || typeof vnode === "number") {
    return escapeHtml(String(vnode));
  }

  // 数组
  if (Array.isArray(vnode)) {
    return vnode.map(renderToString).join("");
  }

  const { type, props = {} } = vnode;

  // 函数组件：调用函数得到 vnode，再递归渲染
  if (typeof type === "function") {
    const result = type(props);
    return renderToString(result);
  }

  // HTML 元素
  let html = `<${type}`;

  // 处理属性
  const { children, ...attrs } = props;
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      html += ` class="${escapeHtml(value)}"`;
    } else if (key === "htmlFor") {
      html += ` for="${escapeHtml(value)}"`;
    } else if (key.startsWith("on")) {
      // 跳过事件处理器（SSR 不输出事件）
      continue;
    } else if (typeof value === "boolean") {
      if (value) html += ` ${key}`;
    } else {
      html += ` ${key}="${escapeHtml(String(value))}"`;
    }
  }

  // 自闭合标签
  const voidElements = new Set(["br", "hr", "img", "input", "meta", "link"]);
  if (voidElements.has(type)) {
    return html + " />";
  }

  html += ">";

  // 子节点
  if (children !== undefined) {
    if (Array.isArray(children)) {
      html += children.map(renderToString).join("");
    } else {
      html += renderToString(children);
    }
  }

  html += `</${type}>`;
  return html;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// createElement 辅助函数（类似 React.createElement）
function h(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.length === 1 ? children[0] : children,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 二、文件系统路由
// ═══════════════════════════════════════════════════════════════════════════
//
// Next.js 的文件系统路由：
//   pages/index.js       → /
//   pages/about.js       → /about
//   pages/blog/[slug].js → /blog/:slug（动态路由）
//   pages/[...all].js    → /*（catch-all 路由）
//
// 本文件用模拟的文件系统

class FileSystemRouter {
  constructor(pages) {
    this.pages = pages; // { "pages/index.js": component, ... }
  }

  /**
   * 将文件路径转为路由
   * pages/index.js → /
   * pages/about.js → /about
   * pages/blog/[slug].js → /blog/:slug
   */
  getRoutes() {
    const routes = [];

    for (const [filePath, page] of Object.entries(this.pages)) {
      let route = filePath
        .replace(/^pages/, "")   // 去掉 pages 前缀
        .replace(/\.js$/, "")    // 去掉 .js 后缀
        .replace(/\/index$/, "/") // index → /
        .replace(/\[(\w+)\]/g, ":$1"); // [slug] → :slug

      if (route === "") route = "/";

      routes.push({
        path: route,
        component: page.default || page.component,
        getStaticProps: page.getStaticProps,
        getStaticPaths: page.getStaticPaths,
      });
    }

    return routes;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 三、SSG 构建器
// ═══════════════════════════════════════════════════════════════════════════
//
// 构建流程：
//   1. 遍历所有路由
//   2. 静态路由：直接调用 getStaticProps → renderToString → 输出 HTML
//   3. 动态路由：先调用 getStaticPaths 获取所有路径 → 逐个渲染
//   4. 输出到 dist/ 目录

class SSGBuilder {
  constructor(options = {}) {
    this.outputDir = options.outputDir || "dist";
    this.htmlTemplate = options.htmlTemplate || DEFAULT_TEMPLATE;
    this.outputs = new Map(); // 虚拟输出（不真正写磁盘）
    this.buildTime = Date.now();
  }

  async build(routes) {
    console.log("  [SSG] 开始构建...\n");

    for (const route of routes) {
      if (route.path.includes(":")) {
        // 动态路由：需要 getStaticPaths
        await this._buildDynamicRoute(route);
      } else {
        // 静态路由
        await this._buildStaticRoute(route);
      }
    }

    console.log(`\n  [SSG] 构建完成！共生成 ${this.outputs.size} 个页面`);
    return this.outputs;
  }

  async _buildStaticRoute(route) {
    // 获取数据
    let props = {};
    if (route.getStaticProps) {
      const result = await route.getStaticProps({ params: {} });
      props = result.props || {};
    }

    // 渲染组件
    const componentHtml = renderToString(route.component(props));

    // 注入 HTML 模板
    const fullHtml = this.htmlTemplate
      .replace("{{content}}", componentHtml)
      .replace("{{title}}", props.title || "SSG Page")
      .replace("{{__SSG_DATA__}}", JSON.stringify(props));

    // 输出路径
    const outputPath = route.path === "/"
      ? `${this.outputDir}/index.html`
      : `${this.outputDir}${route.path}/index.html`;

    this.outputs.set(outputPath, fullHtml);
    console.log(`    ${route.path} → ${outputPath}`);
  }

  async _buildDynamicRoute(route) {
    if (!route.getStaticPaths) {
      console.log(`    [SKIP] ${route.path}（无 getStaticPaths，跳过）`);
      return;
    }

    // 获取所有动态路径
    const { paths, fallback } = await route.getStaticPaths();
    console.log(`    ${route.path} → ${paths.length} 个页面 (fallback: ${fallback})`);

    for (const pathInfo of paths) {
      const params = pathInfo.params;

      // 替换动态参数：/blog/:slug → /blog/hello-world
      let actualPath = route.path;
      for (const [key, value] of Object.entries(params)) {
        actualPath = actualPath.replace(`:${key}`, value);
      }

      // 获取数据
      let props = {};
      if (route.getStaticProps) {
        const result = await route.getStaticProps({ params });
        props = result.props || {};
      }

      // 渲染
      const componentHtml = renderToString(route.component(props));
      const fullHtml = this.htmlTemplate
        .replace("{{content}}", componentHtml)
        .replace("{{title}}", props.title || "SSG Page")
        .replace("{{__SSG_DATA__}}", JSON.stringify(props));

      const outputPath = `${this.outputDir}${actualPath}/index.html`;
      this.outputs.set(outputPath, fullHtml);
      console.log(`      ${actualPath} → ${outputPath}`);
    }
  }
}

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html>
<head><title>{{title}}</title></head>
<body>
  <div id="root">{{content}}</div>
  <script>window.__SSG_DATA__ = {{__SSG_DATA__}}</script>
  <script src="/bundle.js"></script>
</body>
</html>`;

// ═══════════════════════════════════════════════════════════════════════════
// 四、ISR（Incremental Static Regeneration）模拟
// ═══════════════════════════════════════════════════════════════════════════
//
// ISR 原理：
//   1. 构建时生成静态页面（和 SSG 一样）
//   2. 设置 revalidate 时间（如 60 秒）
//   3. 请求到来时：
//      a. 如果缓存未过期 → 返回缓存的 HTML（极快）
//      b. 如果缓存已过期 → 仍然返回旧 HTML → 后台触发重新生成
//      c. 下次请求时拿到新 HTML
//   4. 这就是 "stale-while-revalidate" 策略

class ISRCache {
  constructor() {
    this.cache = new Map(); // path → { html, generatedAt, revalidate }
  }

  set(path, html, revalidate) {
    this.cache.set(path, {
      html,
      generatedAt: Date.now(),
      revalidate, // 秒
    });
  }

  /**
   * 获取页面
   * @returns {{ html, isStale, needsRegeneration }}
   */
  get(path) {
    const entry = this.cache.get(path);
    if (!entry) return { html: null, isStale: false, needsRegeneration: false };

    const age = (Date.now() - entry.generatedAt) / 1000;
    const isStale = age > entry.revalidate;

    return {
      html: entry.html,
      isStale,
      needsRegeneration: isStale,
      age: Math.round(age),
      revalidate: entry.revalidate,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 五、测试
// ═══════════════════════════════════════════════════════════════════════════

console.log("=== Mini SSG 静态站点生成演示 ===\n");

// ── 定义页面组件 + 数据获取 ──

// 首页
const HomePage = (props) => h("div", { className: "home" },
  h("h1", null, props.title || "Home"),
  h("p", null, `Welcome! We have ${(props.postCount || 0)} blog posts.`),
  h("nav", null,
    h("a", { href: "/about" }, "About"),
    " | ",
    h("a", { href: "/blog" }, "Blog")
  )
);

// 关于页
const AboutPage = (props) => h("div", { className: "about" },
  h("h1", null, "About Us"),
  h("p", null, props.description || "A static site built with SSG.")
);

// 博客列表页
const BlogListPage = (props) => h("div", { className: "blog" },
  h("h1", null, "Blog"),
  h("ul", null,
    ...(props.posts || []).map((post) =>
      h("li", { key: post.slug },
        h("a", { href: `/blog/${post.slug}` }, post.title)
      )
    )
  )
);

// 博客详情页（动态路由）
const BlogPostPage = (props) => h("article", { className: "post" },
  h("h1", null, props.title),
  h("time", null, props.date),
  h("div", { className: "content" }, props.content)
);

// 模拟数据源
const MOCK_POSTS = [
  { slug: "hello-ssg", title: "Hello SSG", date: "2024-01-01", content: "This is the first post about Static Site Generation." },
  { slug: "react-deep-dive", title: "React Deep Dive", date: "2024-01-15", content: "A deep dive into React internals and Fiber architecture." },
  { slug: "vite-vs-webpack", title: "Vite vs Webpack", date: "2024-02-01", content: "Comparing modern build tools for frontend development." },
];

// 模拟 pages/ 文件系统
const pages = {
  "pages/index.js": {
    component: HomePage,
    getStaticProps: async () => ({
      props: { title: "My SSG Blog", postCount: MOCK_POSTS.length },
    }),
  },
  "pages/about.js": {
    component: AboutPage,
    getStaticProps: async () => ({
      props: { description: "Built with Mini SSG framework for learning." },
    }),
  },
  "pages/blog/index.js": {
    component: BlogListPage,
    getStaticProps: async () => ({
      props: { posts: MOCK_POSTS.map(({ slug, title }) => ({ slug, title })) },
    }),
  },
  "pages/blog/[slug].js": {
    component: BlogPostPage,
    // getStaticPaths：告诉 SSG 需要生成哪些动态路径
    getStaticPaths: async () => ({
      paths: MOCK_POSTS.map((post) => ({ params: { slug: post.slug } })),
      fallback: false, // false = 未列出的路径返回 404
    }),
    // getStaticProps：根据参数获取页面数据
    getStaticProps: async ({ params }) => {
      const post = MOCK_POSTS.find((p) => p.slug === params.slug);
      return { props: { ...post, title: post.title } };
    },
  },
};

(async () => {
  // ── 测试 1：renderToString ──

  console.log("【测试 1】renderToString\n");

  const simpleVnode = h("div", { className: "app" },
    h("h1", null, "Hello SSG"),
    h("p", null, "This is ", h("strong", null, "static"), " content."),
    h("img", { src: "/logo.png", alt: "logo" })
  );

  const html = renderToString(simpleVnode);
  console.log("  虚拟 DOM → HTML:");
  console.log("    " + html);

  // 函数组件
  const Greeting = ({ name }) => h("span", null, `Hello, ${name}!`);
  const greetHtml = renderToString(h(Greeting, { name: "World" }));
  console.log("\n  函数组件 → HTML:");
  console.log("    " + greetHtml);

  // ── 测试 2：文件系统路由 ──

  console.log("\n\n【测试 2】文件系统路由\n");

  const router = new FileSystemRouter(pages);
  const routes = router.getRoutes();

  console.log("  路由表:");
  routes.forEach((r) => {
    const flags = [];
    if (r.getStaticProps) flags.push("getStaticProps");
    if (r.getStaticPaths) flags.push("getStaticPaths");
    console.log(`    ${r.path.padEnd(20)} [${flags.join(", ")}]`);
  });

  // ── 测试 3：SSG 构建 ──

  console.log("\n\n【测试 3】SSG 完整构建\n");

  const builder = new SSGBuilder({ outputDir: "dist" });
  const outputs = await builder.build(routes);

  console.log("\n  生成的文件:");
  for (const [path, html] of outputs) {
    console.log(`\n  ── ${path} ──`);
    // 只显示 <div id="root"> 内容
    const match = html.match(/<div id="root">([\s\S]*?)<\/div>/);
    if (match) {
      console.log("    " + match[1].slice(0, 120) + (match[1].length > 120 ? "..." : ""));
    }
  }

  // ── 测试 4：ISR 模拟 ──

  console.log("\n\n【测试 4】ISR（Incremental Static Regeneration）\n");

  const isrCache = new ISRCache();

  // 模拟构建时缓存
  isrCache.set("/", "<html>Home Page v1</html>", 2); // 2 秒过期
  isrCache.set("/about", "<html>About Page</html>", 60); // 60 秒过期

  // 立即请求（未过期）
  const result1 = isrCache.get("/");
  console.log("  请求 / (刚生成):");
  console.log(`    isStale: ${result1.isStale}, age: ${result1.age}s, revalidate: ${result1.revalidate}s`);
  console.log(`    → 返回缓存 HTML`);

  // 模拟等待（手动修改时间）
  isrCache.cache.get("/").generatedAt = Date.now() - 3000; // 假装 3 秒前生成的

  const result2 = isrCache.get("/");
  console.log("\n  请求 / (3 秒后, revalidate=2s):");
  console.log(`    isStale: ${result2.isStale}, age: ${result2.age}s`);
  console.log(`    → 返回旧 HTML + 后台触发重新生成`);
  console.log(`    → 下次请求将得到新 HTML`);

  // ── 测试 5：SSG vs SSR vs CSR 对比 ──

  console.log("\n\n【测试 5】SSG vs SSR vs CSR 对比\n");

  const comparison = [
    ["", "SSG", "SSR", "CSR"],
    ["渲染时机", "构建时", "请求时", "客户端"],
    ["首屏速度", "极快(CDN)", "快(服务端渲染)", "慢(下载JS→执行)"],
    ["数据新鲜度", "构建时快照", "实时", "实时"],
    ["服务器需求", "静态托管", "Node.js 服务器", "静态托管"],
    ["SEO", "友好", "友好", "需要额外处理"],
    ["适用场景", "博客/文档/营销页", "电商/社交", "后台管理系统"],
    ["Next.js API", "getStaticProps", "getServerSideProps", "useEffect"],
  ];

  comparison.forEach((row, i) => {
    if (i === 0) {
      console.log("  " + row.map((c) => c.padEnd(18)).join(""));
      console.log("  " + "─".repeat(72));
    } else {
      console.log("  " + row.map((c) => c.padEnd(18)).join(""));
    }
  });

  console.log("\n\n=== 面试要点 ===");
  console.log("1. SSG = 构建时执行组件 → renderToString → 输出静态 HTML → 部署 CDN");
  console.log("2. getStaticProps：构建时获取数据，返回 { props } 传给组件");
  console.log("3. getStaticPaths：动态路由必需，告诉 SSG 要预渲染哪些路径");
  console.log("4. fallback: false(404) / true(首次SSR+缓存) / 'blocking'(等待生成)");
  console.log("5. ISR = SSG + revalidate：stale-while-revalidate 策略，后台增量更新");
  console.log("6. SSG 的 HTML 中注入 __SSG_DATA__，客户端 hydrate 时复用（避免重复请求）");
  console.log("7. 文件系统路由：pages/目录结构 → 路由表，[slug] → 动态参数");
})();
