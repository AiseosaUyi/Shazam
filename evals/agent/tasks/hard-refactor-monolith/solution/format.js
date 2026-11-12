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

module.exports = { money, pad, formatReport };
