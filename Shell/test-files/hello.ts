interface User {
  id: number;
  name: string;
  email: string;
}

// TODO: add validation
function createUser(name: string, email: string): User {
  return {
    id: Date.now(),
    name,
    email,
  };
}

const printUser = (user: User): void => {
  console.log(`[${user.id}] ${user.name} <${user.email}>`);
};

export { User, createUser, printUser };
