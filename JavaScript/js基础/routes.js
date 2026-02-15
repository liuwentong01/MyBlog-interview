class Route {
  constructor() {
    this.routes = {};
    this.currentHash = "";
    this.freshRoute = this.freshRoute.bind(this);
    window.addEventListener("load", this.freshRoute, false);
    window.addEventListener("hashchange", this.freshRoute, false);
  }
  // 存储
  storeRoute(path, cb) {
    this.routes[path] = cb || function () {};
  }
  // 更新
  freshRoute() {
    this.currentHash = location.hash.slice(1) || "/";
    this.routes[this.currentHash]();
  }
}
