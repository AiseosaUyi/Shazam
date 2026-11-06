const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('./arrays');

test('chunk splits an array', () => assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]));
