function Promise(exec){
  var self = this;
  self.status = 'pending';
  self.data = '';
  self.onResolveCallback = [];
  self.onRejectCallback = [];
  function resolve(value){
    if(self.status == 'pending'){
      self.status = 'Fulfilled';
      self.data = value;
      self.onResolve.forEach(callback => callback(value));
    }
  }
  function reject(reason){
    if(self.status == 'pending'){
      self.status = 'Rejected';
      self.data = reason;
      self.onReject.forEach(callback => callback(reason));
    }
  }
  try{
    exec(resolve, reject)
  } catch(ex){
    reject(ex);
  }
}

Promise.prototype.then = function(onResolve, onReject){
  var self = this;
  typeof onResolve == 'function' ? onResolve : function(value){return value};
  typeof onReject == 'function' ? onReject : function(value){return value};

  if(self.status == 'Fulfilled'){
    var promise2 = new Promise((resolve, reject) => {
      try{
        var x = onResolve(self.data);
        if(x instanceof Promise){
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
    var promise2 = new Promise((resolve, reject) => {
      try{
        var x = onReject(self.data);
        if(x instanceof Promise){
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
    var promise2 = new Promise((resolve, reject) => {
      self.onResolveCallback.push(function(){
        try{
          var x = onResolve(self.data);
          if (x instanceof Promise) {
            x.then(resolve, reject);
          } else {
            resolve(x);
          }
        } catch(ex){
          reject(ex)
        }
        var x = onResolve(self.data);
        if(x instanceof Promise){
          x.then(resolve, reject);
        } else {
          resolve(x);
        }
      });
      self.onRejectCallback.push(function(){
        try{
          var x = onReject(self.data);
          if (x instanceof Promise) {
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
Promise.prototype.catch = function(onReject){
  return this.then(null, onReject);
}
Promise.resolve = function(value){
  return new Promise((resolve,reject) => {
    resolve(value);
  })
}
Promise.reject = function(){
  return new Promise((resolve, reject) => {
    reject(value);
  })
}
Promise.all = function (promises) {
  return new Promise((resolve, reject) => {
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

Promise.race = function (promises) {
  return new Promise((resolve, reject) => {
      promises.forEach((promise) => {
        promise.then(resolve, reject);
      });
  });
}
Promise.race = function(promises){
  return new Promise((resolve, reject) => {
    promises.forEach((promise) => {
      promise.then(resolve, reject);
    })
  })
}



