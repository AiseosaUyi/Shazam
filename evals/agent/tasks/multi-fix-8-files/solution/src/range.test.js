const test = require('node:test');
const assert = require('node:assert/strict');
const { range } = require('./range');
test('range is inclusive', () => {
  assert.deepEqual(range(1, 3), [1, 2, 3]);
  assert.deepEqual(range(2, 2), [2]);
});
