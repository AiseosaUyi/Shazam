const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPalindrome } = require('./palindrome');

test('simple', () => assert.equal(isPalindrome('abba'), true));
test('ignores case', () => assert.equal(isPalindrome('Racecar'), true));
test('ignores punctuation and spaces', () => assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true));
test('negative', () => assert.equal(isPalindrome('hello'), false));
