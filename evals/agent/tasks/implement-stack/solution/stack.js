class Stack {
  constructor() {
    this.items = [];
  }
  push(x) {
    this.items.push(x);
  }
  pop() {
    if (this.items.length === 0) throw new Error('Stack is empty');
    return this.items.pop();
  }
  peek() {
    return this.items[this.items.length - 1];
  }
  isEmpty() {
    return this.items.length === 0;
  }
  get size() {
    return this.items.length;
  }
}
module.exports = { Stack };
