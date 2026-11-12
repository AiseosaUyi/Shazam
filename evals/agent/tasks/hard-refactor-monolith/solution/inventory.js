// inventory.js: CSV in, priced report out. Parsing, pricing and formatting live in their own modules.
const { parseCsv, toItems } = require('./parse');
const { roundCents, priceItem, summarize } = require('./pricing');
const { money, formatReport } = require('./format');

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
