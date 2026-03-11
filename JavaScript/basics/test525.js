let a = 'ferg(3,10)a13fdsf3(3,4)f2r3rfasf(5,10)'
let flag = false;
let max = 0;
let res = (0,0);
let x = 0, y = 0, first = true, valid = true;
for(let i = 0; i < a.length; i++) {
	if(a[i] === '(') {
		flag = true;
	} else if(a[i] === ')') {
		let tmp = (x * x) + (y * y);
		// console.log(tmp, x, y);
		if(tmp > max && valid) {
			max = tmp;
			res = '(' + x + ',' + y + ')';
		}
		flag = false;
		first = true;
		x = 0;
		y = 0;
		valid = true;
	} else if(a[i] === ',') {
		first = false;
	} else if(first && flag && parseInt(a[i]) >= 0) {
		if(x === 0 && parseInt(a[i]) === 0) {
			valid = false
		}
		x = x * 10 + parseInt(a[i]);
		// console.log(x, 'x')
	} else if(!first && flag && parseInt(a[i]) >= 0) {
		if(y === 0 && parseInt(a[i]) === 0) {
			valid = false
		}
		y = y * 10 + parseInt(a[i]);
		// console.log(y, 'y')
	}
}
console.log(res)
