const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const load = (p) => require(path.join(process.cwd(), p));
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const taskDir = __dirname;
assert.equal(load('constants.js').DAY_MS, 86400000);
assert.equal(load('session.js').expiresAt(1000), 86401000);
assert.equal(load('cache.js').ttl(2), 172800000);
for (const f of ['session.js', 'cache.js']) {
  assert.ok(!/86400000/.test(read(f)), f + ' still contains the literal');
  assert.ok(/require\(['"]\.\/constants(\.js)?['"]\)/.test(read(f)), f + ' must import constants');
}
