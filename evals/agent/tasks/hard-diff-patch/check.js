const assert = require('node:assert/strict');
const path = require('path');
const { diff, patch, unifiedDiff } = require(path.join(process.cwd(), 'diff.js'));

const lcsLen = (a, b) => {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t[0][0];
};
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const randLines = (n, alpha) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(rnd() * alpha)));

// Property: valid script, reproduces b, minimal, and the ops reconstruct a too.
for (let t = 0; t < 400; t++) {
  const a = randLines(Math.floor(rnd() * 14), 2 + Math.floor(rnd() * 4));
  const b = randLines(Math.floor(rnd() * 14), 2 + Math.floor(rnd() * 4));
  const ops = diff(a, b);
  assert.deepEqual(patch(a, ops), b, `round trip failed for ${JSON.stringify([a, b])}`);
  assert.deepEqual(ops.filter((o) => o.op !== 'add').map((o) => o.line), a, 'del+keep must reproduce a');
  assert.deepEqual(ops.filter((o) => o.op !== 'del').map((o) => o.line), b, 'add+keep must reproduce b');
  const changes = ops.filter((o) => o.op !== 'keep').length;
  assert.equal(changes, a.length + b.length - 2 * lcsLen(a, b), `not minimal for ${JSON.stringify([a, b])}`);
  for (const o of ops) assert.ok(['keep', 'add', 'del'].includes(o.op) && typeof o.line === 'string');
}
assert.deepEqual(diff([], []), []);
assert.deepEqual(diff(['a'], ['a']), [{ op: 'keep', line: 'a' }]);
assert.deepEqual(diff([], ['x']), [{ op: 'add', line: 'x' }]);
assert.deepEqual(diff(['x'], []), [{ op: 'del', line: 'x' }]);

// patch verification and error line numbers.
const ops = [{ op: 'keep', line: 'a' }, { op: 'del', line: 'b' }, { op: 'add', line: 'B' }, { op: 'keep', line: 'c' }];
assert.deepEqual(patch(['a', 'b', 'c'], ops), ['a', 'B', 'c']);
assert.throws(() => patch(['a', 'x', 'c'], ops), (e) => e.message === 'Patch does not apply at line 2');
assert.throws(() => patch(['q', 'b', 'c'], ops), (e) => e.message === 'Patch does not apply at line 1');
assert.throws(() => patch(['a', 'b'], ops), (e) => e.message === 'Patch does not apply at line 3');
assert.throws(() => patch(['a', 'b', 'c', 'd', 'e'], ops), (e) => e.message === 'Patch does not apply at line 4');
assert.throws(() => patch(['a'], []), (e) => e.message === 'Patch does not apply at line 1');
assert.deepEqual(patch([], [{ op: 'add', line: 'n' }]), ['n']);

// Unified diff exact output (cases where the minimal script is unique).
assert.equal(unifiedDiff(['x', 'y', 'z'], ['x', 'Y', 'z'], { context: 1 }), '--- a\n+++ b\n@@ -1,3 +1,3 @@\n x\n-y\n+Y\n z\n');
assert.equal(unifiedDiff(['same'], ['same']), '');
assert.equal(unifiedDiff([], []), '');
assert.equal(unifiedDiff([], ['p', 'q']), '--- a\n+++ b\n@@ -0,0 +1,2 @@\n+p\n+q\n');
assert.equal(unifiedDiff(['p', 'q'], []), '--- a\n+++ b\n@@ -1,2 +0,0 @@\n-p\n-q\n');
assert.equal(unifiedDiff(['a'], ['b'], { aName: 'old.txt', bName: 'new.txt' }), '--- old.txt\n+++ new.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n');
const nine = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
// One change in the middle, context 2.
assert.equal(unifiedDiff(nine, nine.map((l) => (l === '5' ? 'five' : l)), { context: 2 }), '--- a\n+++ b\n@@ -3,5 +3,5 @@\n 3\n 4\n-5\n+five\n 6\n 7\n');
// Pure insertion between lines: aCount 0 uses the preceding line number.
assert.equal(unifiedDiff(['a', 'b'], ['a', 'NEW', 'b'], { context: 0 }), '--- a\n+++ b\n@@ -1,0 +2,1 @@\n+NEW\n');
// Two far-apart changes -> two hunks; two close changes -> merged (gap <= 2*context).
const twenty = Array.from({ length: 20 }, (_, i) => 'L' + (i + 1));
const far = twenty.map((l) => (l === 'L2' || l === 'L19' ? l + '!' : l));
assert.equal(
  unifiedDiff(twenty, far, { context: 1 }),
  '--- a\n+++ b\n@@ -1,3 +1,3 @@\n L1\n-L2\n+L2!\n L3\n@@ -18,3 +18,3 @@\n L18\n-L19\n+L19!\n L20\n',
);
const close = twenty.map((l) => (l === 'L5' || l === 'L8' ? l + '!' : l));
assert.equal(
  unifiedDiff(twenty, close, { context: 1 }),
  '--- a\n+++ b\n@@ -4,6 +4,6 @@\n L4\n-L5\n+L5!\n L6\n L7\n-L8\n+L8!\n L9\n',
  'gap of 2 unchanged lines with context 1 merges',
);
const gap3 = twenty.map((l) => (l === 'L5' || l === 'L9' ? l + '!' : l));
assert.equal(
  unifiedDiff(twenty, gap3, { context: 1 }),
  '--- a\n+++ b\n@@ -4,3 +4,3 @@\n L4\n-L5\n+L5!\n L6\n@@ -8,3 +8,3 @@\n L8\n-L9\n+L9!\n L10\n',
  'gap of 3 with context 1 does not merge',
);
// Default context is 3 and the diff applies back.
const d = unifiedDiff(twenty, far);
assert.match(d, /^--- a\n\+\+\+ b\n@@ -1,5 \+1,5 @@\n/);

// Performance: 2000 lines with scattered edits.
const big = Array.from({ length: 2000 }, (_, i) => 'line ' + i);
const edited = big.slice();
for (let i = 50; i < 2000; i += 97) edited[i] = 'changed ' + i;
edited.splice(700, 3);
edited.splice(1500, 0, 'inserted 1', 'inserted 2');
const t0 = Date.now();
const bigOps = diff(big, edited);
assert.deepEqual(patch(big, bigOps), edited);
assert.ok(unifiedDiff(big, edited).startsWith('--- a\n+++ b\n@@ '));
assert.ok(Date.now() - t0 < 4000, `too slow: ${Date.now() - t0}ms`);
console.log('ok');
