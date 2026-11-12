const test = require('node:test');
const assert = require('node:assert/strict');
const { mean } = require('./stats');
test('mean', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), 0);
});
