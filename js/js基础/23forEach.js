/**
 * 
 * @param {*} callback 回调函数
 * @param {*} thisArg  可选参数。当执行回调函数 callback 时，用作 this 的值。
 */
Array.prototype.forEach2 = function(callback, thisArg) {
	if (this == null) {
			throw new TypeError('this is null or not defined')
	}
	if (typeof callback !== "function") {
			throw new TypeError(callback + ' is not a function')
	}
	const arr = this;
	for(let i = 0; i < arr.length; i++) {
		callback.call(thisArg, arr[i], i, arr)
	}
}

const a = [1,2,3]
a.forEach2(function(item){
	// this 为 a数组
	console.log(item * 2);
}, a)
