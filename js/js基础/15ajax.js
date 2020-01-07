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
