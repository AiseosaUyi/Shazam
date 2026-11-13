// inventory.js: CSV in, priced report out. Everything lives in this one file.

const TAX_RATES = { food: 0.05, book: 0, electronics: 0.2, default: 0.1 };
const DISCOUNT_TIERS = [
  { min: 50, rate: 0.12 },
  { min: 10, rate: 0.05 },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toItems(rows) {
  const [header, ...body] = rows;
  const idx = {};
  header.forEach((h, i) => { idx[h.trim().toLowerCase()] = i; });
  const errors = [];
  const items = [];
  body.forEach((r, n) => {
    const line = n + 2;
    if (r.length === 1 && r[0].trim() === '') return;
    const name = (r[idx.name] || '').trim();
    const qty = Number(r[idx.qty]);
    const price = Number(r[idx.price]);
    const category = (r[idx.category] || 'default').trim().toLowerCase();
    if (!name) { errors.push(`line ${line}: missing name`); return; }
    if (!Number.isInteger(qty) || qty < 0) { errors.push(`line ${line}: bad qty "${r[idx.qty]}"`); return; }
    if (!(price >= 0)) { errors.push(`line ${line}: bad price "${r[idx.price]}"`); return; }
    items.push({ name, qty, price, category });
  });
  return { items, errors };
}

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

function money(x) {
  const [whole, frac] = x.toFixed(2).split('.');
  return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + frac;
}

function pad(s, n, right) {
  s = String(s);
  return s.length >= n ? s : right ? ' '.repeat(n - s.length) + s : s + ' '.repeat(n - s.length);
}

function formatReport(priced, summary, errors, opts = {}) {
  const width = Math.max(4, ...priced.map((p) => p.name.length));
  const out = [];
  out.push(`${pad('Item', width)}  ${pad('Qty', 5, true)}  ${pad('Total', 12, true)}`);
  out.push('-'.repeat(width + 21));
  for (const p of priced) out.push(`${pad(p.name, width)}  ${pad(p.qty, 5, true)}  ${pad(money(p.total), 12, true)}`);
  out.push('-'.repeat(width + 21));
  const cats = Object.keys(summary.byCategory).sort();
  for (const c of cats) out.push(`${c}: ${summary.byCategory[c].count} units, ${money(summary.byCategory[c].total)}`);
  out.push(`Grand total: ${money(summary.grand)}`);
  if (errors.length && !opts.hideErrors) {
    out.push('');
    out.push(`${errors.length} problem(s):`);
    errors.forEach((e) => out.push(`  ${e}`));
  }
  return out.join('\n');
}

function run(csvText, opts = {}) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { report: 'No data', priced: [], errors: [] };
  const { items, errors } = toItems(rows);
  let priced = items.map(priceItem);
  if (opts.category) priced = priced.filter((p) => p.category === opts.category.toLowerCase());
  if (opts.minTotal !== undefined) priced = priced.filter((p) => p.total >= opts.minTotal);
  priced.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const summary = summarize(priced);
  return { report: formatReport(priced, summary, errors, opts), priced, errors, summary };
}

module.exports = { run, parseCsv, priceItem, roundCents, money };
