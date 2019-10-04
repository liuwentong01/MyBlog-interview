function MyPromise(exec){
  var self = this;
  self.status = 'pending';
  self.data = '';
  self.onResolveCallback = [];
  self.onRejectCallback = [];
  function resolve(value){
    if(self.status == 'pending'){
      self.status = 'Fulfilled';
      self.data = value;
      self.onResolveCallback.forEach(callback => callback(value));
    }
  }
  function reject(reason){
    if(self.status == 'pending'){
      self.status = 'Rejected';
      self.data = reason;
      self.onRejectCallback.forEach(callback => callback(reason));
    }
  }
  try{
    exec(resolve, reject)
  } catch(ex){
    reject(ex);
  }
}

MyPromise.prototype.then = function(onResolve, onReject){
  var self = this;
  var promise2;
  typeof onResolve == 'function' ? onResolve : function(value){return value};
  typeof onReject == 'function' ? onReject : function(value){return value};

  if(self.status == 'Fulfilled'){
    return promise2 = new MyPromise((resolve, reject) => {
      try{
        var x = onResolve(self.data);
        if(x instanceof MyPromise){
          x.then(resolve, reject);
        } else{
          resolve(x);
        }
      }catch(ex){
        reject(ex);
      }
    })
  }

  if(self.status == 'Rejected'){
    return promise2 = new MyPromise((resolve, reject) => {
      try{
        var x = onReject(self.data);
        if(x instanceof MyPromise){
          x.then(resolve, reject);
        } else{
          resolve(x);
        }
      } catch(ex){
        reject(ex);
      }
    });
  }

  if(self.status == 'pending'){
    return promise2 = new MyPromise((resolve, reject) => {
      self.onResolveCallback.push(function(){
        try{
          var x = onResolve(self.data);
          if (x instanceof MyPromise) {
            x.then(resolve, reject);
          } else {
            resolve(x);
          }
        } catch(ex){
          reject(ex)
        }
        var x = onResolve(self.data);
        if(x instanceof MyPromise){
          x.then(resolve, reject);
        } else {
          resolve(x);
        }
      });
      self.onRejectCallback.push(function(){
        try{
          var x = onReject(self.data);
          if (x instanceof MyPromise) {
            x.then(resolve, reject);
          } else {
            resolve(x);
          }
        }catch(ex){
          reject(ex);
        }
      })

    });
  }
}
MyPromise.prototype.catch = function(onReject){
  return this.then(null, onReject);
}
MyPromise.resolve = function(value){
  return new MyPromise((resolve,reject) => {
    resolve(value);
  })
}
MyPromise.reject = function(){
  return new MyPromise((resolve, reject) => {
    reject(value);
  })
}
MyPromise.all = function (promises) {
  return new MyPromise((resolve, reject) => {
    let values = []
    let count = 0
    promises.forEach((promise, index) => {
      promise.then(value => {
        console.log('value:', value, 'index:', index)
        values[index] = value
        count++
        if (count === promises.length) {
          resolve(values)
        }
      }, reject)
    })
  })
}

MyPromise.race = function (promises) {
  return new MyPromise((resolve, reject) => {
      promises.forEach((promise) => {
        promise.then(resolve, reject);
      });
  });
}
MyPromise.race = function(promises){
  return new MyPromise((resolve, reject) => {
    promises.forEach((promise) => {
      promise.then(resolve, reject);
    })
  })
}


var promise = new MyPromise((resolve, reject) =>{
  resolve(4);
})
promise.then(
  () => 5
).then(val => {console.log(val)});



