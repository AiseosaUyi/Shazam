const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const load = (p) => require(path.join(process.cwd(), p));
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const taskDir = __dirname;
const { getTotal } = load('prices.js');
(async () => {
  assert.equal(await getTotal([1, 2, 3]), 60);
  assert.equal(await getTotal([]), 0);
  assert.equal(await getTotal([5]), 50);
})().catch((e) => { console.error(e); process.exit(1); });
