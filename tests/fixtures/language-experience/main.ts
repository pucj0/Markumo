// TypeScript 中文
interface User { name: string; age: number }
const user: User = { name: "LightEdit", age: 42 };
function greet(value: User): string { return value.name; }
console.log(greet(user));
