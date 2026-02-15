/**通过setTimeout来实现setTimeInterval */
setTimeout(() => {
  setTimeout(arguments.callee, 500);
},500)

