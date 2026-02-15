<<<<<<< HEAD
//注意ajax其他api
const xhr = new XMLHttpRequest()
xhr.onreadystatechange = () => {
    if (xhr.readystate == 4) {
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status == 304) {
            alert(xhr.responseText)
        } else {
            alert("Request was unsuccessful: " + xhr.status)
        }
    }
}
xhr.open("get", "example.php", true)
xhr.send(null)
=======
const getJSON = function(url) {
    return new Promise((resolve, reject) => {
        const xhr = XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Mscrosoft.XMLHttp');
        xhr.open('GET', url, false);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200 || xhr.status === 304) {
                resolve(xhr.responseText);
            } else {
                reject(new Error(xhr.responseText));
            }
        }
        xhr.send();
    })
}
>>>>>>> af38c9aae2c631c04c8b9c204ca7bbd1372e5903
