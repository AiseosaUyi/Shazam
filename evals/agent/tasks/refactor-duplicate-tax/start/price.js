function bookPrice(base) {
  return Math.round(base * 1.2 * 100) / 100;
}
function toyPrice(base) {
  return Math.round(base * 1.2 * 100) / 100 + 2;
}
function foodPrice(base) {
  return Math.round(base * 1.2 * 100) / 100 - 0.5;
}
module.exports = { bookPrice, toyPrice, foodPrice };
