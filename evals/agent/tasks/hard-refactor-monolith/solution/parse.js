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

module.exports = { parseCsv, toItems };
