const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slug');
test('slugify', () => {
  assert.equal(slugify('  Hello World! '), 'hello-world');
  assert.equal(slugify('a  b'), 'a-b');
});
