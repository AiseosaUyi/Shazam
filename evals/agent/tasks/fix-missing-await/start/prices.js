const fetchPrice = (id) => new Promise((resolve) => setTimeout(() => resolve(id * 10), 5));

async function getTotal(ids) {
  const prices = ids.map((id) => fetchPrice(id));
  return prices.reduce((a, b) => a + b, 0);
}
module.exports = { getTotal, fetchPrice };
