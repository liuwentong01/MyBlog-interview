let nAdd;
let t = () => {
  let n = 99;
  nAdd = () => {
    n++;
  };
  let t2 = () => {
    console.log(n);
  };
  return t2;
};

let a1 = t();
let a2 = t();

nAdd();
a1(); //99
a2(); //100
