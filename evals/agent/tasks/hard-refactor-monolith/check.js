const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();
const read = (f) => fs.readFileSync(path.join(cwd, f), 'utf8');

// --- structure ---
for (const f of ['inventory.js', 'parse.js', 'pricing.js', 'format.js']) assert.ok(fs.existsSync(path.join(cwd, f)), `${f} is missing`);
assert.ok(read('inventory.js').trimEnd().split('\n').length <= 40, 'inventory.js must be at most 40 lines');
const modules = ['inventory.js', 'parse.js', 'pricing.js', 'format.js'];
const defined = {};
for (const f of modules) for (const m of read(f).matchAll(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/gm)) (defined[m[1]] ||= []).push(f);
for (const name of ['parseCsv', 'toItems', 'roundCents', 'priceItem', 'summarize', 'money', 'pad', 'formatReport', 'run']) {
  assert.equal((defined[name] || []).length, 1, `${name} must be defined in exactly one file (found in: ${(defined[name] || []).join(', ') || 'none'})`);
}
assert.deepEqual(defined.parseCsv, ['parse.js']);
assert.deepEqual(defined.toItems, ['parse.js']);
assert.deepEqual(defined.priceItem, ['pricing.js']);
assert.deepEqual(defined.summarize, ['pricing.js']);
assert.deepEqual(defined.roundCents, ['pricing.js']);
assert.deepEqual(defined.formatReport, ['format.js']);
assert.deepEqual(defined.money, ['format.js']);
assert.deepEqual(defined.run, ['inventory.js']);
for (const f of ['parse.js', 'pricing.js', 'format.js']) assert.ok(!/require\(/.test(read(f)), `${f} must not require anything`);
assert.ok(/TAX_RATES\s*=/.test(read('pricing.js')) && /DISCOUNT_TIERS\s*=/.test(read('pricing.js')));
assert.ok(!/TAX_RATES\s*=|DISCOUNT_TIERS\s*=/.test(read('inventory.js')));

// --- exports ---
const mod = (f) => require(path.join(cwd, f));
assert.deepEqual(Object.keys(mod('inventory.js')).sort(), ['money', 'parseCsv', 'priceItem', 'roundCents', 'run']);
assert.deepEqual(Object.keys(mod('parse.js')).sort(), ['parseCsv', 'toItems']);
assert.deepEqual(Object.keys(mod('pricing.js')).sort(), ['DISCOUNT_TIERS', 'TAX_RATES', 'priceItem', 'roundCents', 'summarize']);
assert.deepEqual(Object.keys(mod('format.js')).sort(), ['formatReport', 'money', 'pad']);

// --- behavior identical to the original on many inputs ---
const orig = require(path.join(__dirname, 'reference', 'inventory.original.js'));
const now = mod('inventory.js');
const inputs = [
  'name,qty,price,category\nApple,3,0.5,food\nNovel,1,12.99,book\nLaptop,2,999.99,electronics\n',
  'name,qty,price,category\r\nWidget,10,2.5,\r\nGadget,50,1.1,toys\r\n',
  'Name, QTY ,Price,CATEGORY\n"Smith, Jane\'s ""Best"" Pen",12,1.25,food\n',
  'name,qty,price,category\n,3,1,food\nOk,x,1,food\nNeg,-2,1,food\nBad,2,abc,food\nGood,2,1,food\n',
  'name,qty,price,category\nA,1,0.1,food\nB,3,0.1,food\nC,7,0.7,book\n\n\nD,1,1234567.891,electronics',
  'name,qty,price\nOnlyThree,2,3\n',
  'name,qty,price,category\nTie1,2,5,book\nTie2,2,5,book\nTie0,2,5,book\n',
  'name,qty,price,category\nBulk,100,0.99,food\nMid,10,10.1,electronics\nLow,9,10.1,electronics\n',
  '',
  'name,qty,price,category\n',
  'name,qty,price,category\nLong item name that is quite long indeed,1,1,food\nx,1,1,food',
];
const optionSets = [{}, { category: 'FOOD' }, { minTotal: 5 }, { hideErrors: true }, { category: 'book', minTotal: 0 }, { minTotal: 1e9 }];
let compared = 0;
for (const csv of inputs) {
  for (const opts of optionSets) {
    let a, b, ea, eb;
    try { a = orig.run(csv, opts); } catch (e) { ea = e.message; }
    try { b = now.run(csv, opts); } catch (e) { eb = e.message; }
    assert.equal(eb, ea, `error behavior differs for ${JSON.stringify(csv.slice(0, 30))} ${JSON.stringify(opts)}`);
    assert.deepEqual(b, a, `result differs for ${JSON.stringify(csv.slice(0, 40))} ${JSON.stringify(opts)}`);
    compared++;
  }
}
for (const csv of inputs) assert.deepEqual(now.parseCsv(csv), orig.parseCsv(csv));
for (const it of [{ name: 'x', qty: 49, price: 1.005, category: 'food' }, { name: 'y', qty: 50, price: 3.333, category: 'weird' }, { name: 'z', qty: 0, price: 5, category: 'book' }]) {
  assert.deepEqual(now.priceItem(it), orig.priceItem(it));
}
for (const n of [0, 1.005, 1234.5, 1e6, 0.1 + 0.2]) { assert.equal(now.roundCents(n), orig.roundCents(n)); assert.equal(now.money(n), orig.money(n)); }
assert.equal(compared, inputs.length * optionSets.length);
console.log('ok');
