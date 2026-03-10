const greet = (name) => {
  console.log(`Hello, ${name}!`);
};

// TODO: add error handling
function fetchUser(id) {
  return fetch(`/api/users/${id}`)
    .then(res => res.json())
    .then(data => {
      console.log("User data:", data);
      return data;
    });
}

// TODO: implement caching
function getConfig() {
  return {
    port: 3000,
    host: "localhost",
    debug: true,
  };
}

greet("World");
module.exports = { greet, fetchUser, getConfig };
