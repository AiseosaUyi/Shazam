import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatchesFromText, applySearchReplace } from '../src/lib/agent/patcher';

describe('Surgical Code Patcher Tests', () => {
  it('parses surgical search-and-replace blocks', () => {
    const text = `
I will fix the status code check.

<<<< SEARCH: src/api/handler.ts
if (res.status === 200) {
  return res.json();
}
====
if (res.ok) {
  return res.json();
}
>>>>

Let me know if that works!
`;

    const patches = parsePatchesFromText(text);
    assert.equal(patches.length, 1);
    assert.equal(patches[0].type, 'search_replace');
    assert.equal(patches[0].path, 'src/api/handler.ts');
  });

  it('applies exact search and replace correctly', () => {
    const original = `function greet() {\n  console.log("hello");\n}`;
    const patch = {
      type: 'search_replace' as const,
      path: 'greet.js',
      searchBlock: 'console.log("hello");',
      replaceBlock: 'console.log("hello world!");',
    };

    const res = applySearchReplace(original, patch);
    assert.equal(res.success, true);
    assert.equal(res.updatedContent, `function greet() {\n  console.log("hello world!");\n}`);
  });

  it('handles line-ending differences in search and replace', () => {
    const original = 'first\r\nsecond\r\nthird';
    const patch = {
      type: 'search_replace' as const,
      path: 'file.txt',
      searchBlock: 'second',
      replaceBlock: 'TWO',
    };

    const res = applySearchReplace(original, patch);
    assert.equal(res.success, true);
    assert.ok(res.updatedContent?.includes('TWO'));
  });

  it('fails gracefully when search block is not found', () => {
    const original = `const a = 1;`;
    const patch = {
      type: 'search_replace' as const,
      path: 'test.ts',
      searchBlock: `const b = 2;`,
      replaceBlock: `const b = 3;`,
    };

    const res = applySearchReplace(original, patch);
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('Could not locate'));
  });
});
