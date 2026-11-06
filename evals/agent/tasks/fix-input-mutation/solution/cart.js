function addItem(cart, item) {
  return { ...cart, items: [...cart.items, item], total: cart.total + item.price };
}
module.exports = { addItem };
