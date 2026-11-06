function addItem(cart, item) {
  cart.items.push(item);
  cart.total += item.price;
  return cart;
}
module.exports = { addItem };
