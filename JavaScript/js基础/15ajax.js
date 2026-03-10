// 手写 AJAX —— 基于 Promise 封装，支持 GET/POST
function ajax({ method = "GET", url, data = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    xhr.setRequestHeader("Accept", "application/json");
    Object.keys(headers).forEach((key) => {
      xhr.setRequestHeader(key, headers[key]);
    });

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300 || xhr.status === 304) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`Request failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = function () {
      reject(new Error("Network error"));
    };

    xhr.send(data ? JSON.stringify(data) : null);
  });
}

// 使用示例
ajax({ url: "example.php" })
  .then((res) => console.log(res))
  .catch((err) => console.error(err));
