function jsonp({ url, params = {}, callback }) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    // 用随机函数名避免全局污染和命名冲突
    const cbName = callback || `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    window[cbName] = function (data) {
      resolve(data);
      document.body.removeChild(script);
      delete window[cbName];
    };

    script.onerror = function () {
      document.body.removeChild(script);
      delete window[cbName];
      reject(new Error(`JSONP request to ${url} failed`));
    };

    const query = Object.entries({ ...params, callback: cbName })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    script.src = `${url}?${query}`;
    document.body.appendChild(script);
  });
}

// 使用示例
jsonp({
  url: "http://localhost:3000/say",
  params: { wd: "Iloveyou" },
  callback: "show",
}).then((data) => {
  console.log(data);
});
