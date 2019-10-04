/**通过setTimeout来实现setTimeInterval */
setInterval(() => {
  setTimeout(arguments.callee, 500);
},500)

