/**
 * @param {*} callback 回调函数
 * @param {*} thisArg  可选参数。当执行回调函数 callback 时，用作 this 的值。
 */
 Array.prototype.filter2 = function(callback, thisArg) {
	if (this == null) {
			throw new TypeError('this is null or not defined')
	}
	if (typeof callback !== "function") {
			throw new TypeError(callback + ' is not a function')
	}
	const arr = this;
	const res = [];
	for(let i = 0; i < arr.length; i++) {
		if(callback.call(thisArg, arr[i], i, arr)) {
			res.push(arr[i])
		}
	}
	return res;
}

const a = [1,2,3]
const newa = a.filter2(function(item){
	return item > 2;
}, a)

console.log(newa);