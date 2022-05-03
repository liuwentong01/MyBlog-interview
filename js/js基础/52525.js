var entry = {  a: {    b: {      c: {        dd: "abcdd",      },    },    d: {      xx: "adxx",    },    e: "ae",  },};// 要求转换成如下对象
var output = {  "a.b.c.dd": "abcdd",  "a.d.xx": "adxx",  "a.e": "ae",};

let res = {};
function flat(obj, key) {
	for(let k in obj) {
		if(typeof obj[k] === 'object') {
			flat(obj[k], key + '.' + k)
		} else {
			res[key.slice(1)+'.' + k] = obj[k];
		}
	}
}
flat(entry, '');
console.log(res);

