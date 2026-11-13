const TAX_RATES = { food: 0.05, book: 0, electronics: 0.2, default: 0.1 };
const DISCOUNT_TIERS = [
  { min: 50, rate: 0.12 },
  { min: 10, rate: 0.05 },
];

function roundCents(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function priceItem(item) {
  const subtotal = roundCents(item.qty * item.price);
  const tier = DISCOUNT_TIERS.find((t) => item.qty >= t.min);
  const discount = tier ? roundCents(subtotal * tier.rate) : 0;
  const taxable = subtotal - discount;
  const rate = TAX_RATES[item.category] !== undefined ? TAX_RATES[item.category] : TAX_RATES.default;
  const tax = roundCents(taxable * rate);
  return { ...item, subtotal, discount, tax, total: roundCents(taxable + tax) };
}

function summarize(priced) {
  const byCategory = {};
  let grand = 0;
  for (const p of priced) {
    const c = byCategory[p.category] || (byCategory[p.category] = { count: 0, total: 0 });
    c.count += p.qty;
    c.total = roundCents(c.total + p.total);
    grand = roundCents(grand + p.total);
  }
  return { byCategory, grand, lines: priced.length };
}

module.exports = { TAX_RATES, DISCOUNT_TIERS, roundCents, priceItem, summarize };
