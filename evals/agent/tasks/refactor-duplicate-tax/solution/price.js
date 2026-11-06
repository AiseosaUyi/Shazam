function withTax(base) {
  return Math.round(base * 1.2 * 100) / 100;
}
function bookPrice(base) {
  return withTax(base);
}
function toyPrice(base) {
  return withTax(base) + 2;
}
function foodPrice(base) {
  return withTax(base) - 0.5;
}
module.exports = { bookPrice, toyPrice, foodPrice };
