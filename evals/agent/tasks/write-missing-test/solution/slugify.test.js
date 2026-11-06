const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('./slugify');

test('lowercases and dashes spaces', () => assert.equal(slugify('Hello World'), 'hello-world'));
test('trims', () => assert.equal(slugify('  Trim me  '), 'trim-me'));
test('collapses punctuation', () => assert.equal(slugify('Hello, World!'), 'hello-world'));
test('no leading or trailing dashes', () => assert.equal(slugify('--a--b--'), 'a-b'));
