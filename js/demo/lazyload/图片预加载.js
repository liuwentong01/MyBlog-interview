/**
 * 方案一： 通过将图片指定为元素背景
 * 图片预加载 （方案二：适合加载大量图片）
 */
var img = new Array();
function preload(){
  for(let i = 0; i < preload.arguments.length; i++){
    img[i] = new Image();
    img[i].src = preload.arguments[i];
  }
}
preload("http://domain.tld/gallery/image-001.jpg", "http://domain.tld/gallery/image-002.jpg","http://domain.tld/gallery/image-003.jpg");



/**
 * 图片预加载  （方案三： Ajax）
 */
window.onload = function(){
  setTimeout(function(){
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "http://domain.tld/preload.js");
    xhr.send();
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "http://domain.tld/preload.css");
    xhr.send();
    new Image().src = "http://domain.tld/preload.png";
  }, 1000)
}


/**用JavaScript模拟方式二 */
window.onload = function() {
  setTimeout(function() {
    var head = document.getElementsByTagName("head")[0];
    var css = document.createElement("link");
    css.type = "text/css";
    css.rel = "stylesheet";
    css.href = "http://domain.tld/preload.css";

    var js = document.createElement("script");
    js.type = "text/javascript";
    js.src = "http://domain.tld/preload.js";

    head.appendChild(css);
    head.appendChild(js);

    // preload image
    new Image().src = "http://domain.tld/preload.png";
  }, 1000);
};
