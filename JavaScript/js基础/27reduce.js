/**
 * 
 * @param {*} callback 
 * @param {*} initialValue 
 * @returns 
 */
Array.prototype.reduce2 = function(callback, initialValue) {
	if (this == null || this.length < 1) {
			throw new TypeError('this is null or not defined')
	}
	if (typeof callback !== "function") {
			throw new TypeError(callback + ' is not a function')
	}
	const arr = this;
	let acc;
	
	if (arguments.length > 1) {
			acc = initialValue
	} else {
			acc = arr[0];
	}
	for(let i = arguments.length > 1 ? 0 : 1; i < arr.length; i++) {
		acc = callback(acc, arr[i], i, arr);
	}
	return acc
}

const a = [1,2,3]
const value = a.reduce2(function(lastSum, currentValue, index, a){
	return lastSum + currentValue;
}, 4)
console.log(value);