const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunk, unique } = require('./arrays');

test('chunk splits an array', () => assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]));
test('unique removes duplicates keeping order', () => assert.deepEqual(unique([3, 1, 3, 2, 1]), [3, 1, 2]));
test('unique of empty is empty', () => assert.deepEqual(unique([]), []));
