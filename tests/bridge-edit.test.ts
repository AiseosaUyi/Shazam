import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const { replaceLiteral } = require('../desktop/bridge-core.js');

/** Build a dollar-sign string without using literal $ in source — avoids edit_file's own bug. */
const DD = '$' + '$';       // $$
const DAND = '$' + '&';     // $&
const D1 = '$' + '1';       // $1
const DBACK = '$' + '`';    // $`
const DSQUOTE = "$" + "'";   // $'

describe('replaceLiteral', () => {
  it('replaces X in aXb with $$ literally', () => {
    assert.strictEqual(replaceLiteral('aXb', 'X', DD), 'a$$b');
  });

  it('replaces X in aXb with $& literally', () => {
    assert.strictEqual(replaceLiteral('aXb', 'X', DAND), 'a$&b');
  });

  it('replaces X in aXb with $1 literally', () => {
    assert.strictEqual(replaceLiteral('aXb', 'X', D1), 'a$1b');
  });

  it('replaces X in aXb with $` literally', () => {
    assert.strictEqual(replaceLiteral('aXb', 'X', DBACK), 'a$`b');
  });

  it('replaces X in aXb with plain literally', () => {
    assert.strictEqual(replaceLiteral('aXb', 'X', 'plain'), 'aplainb');
  });

  it('returns text unchanged when old_string is not found', () => {
    assert.strictEqual(replaceLiteral('hello world', 'NOPE', 'foo'), 'hello world');
  });

  it('only replaces the first occurrence', () => {
    assert.strictEqual(
      replaceLiteral('aXbXc', 'X', 'replacement'),
      'areplacementbXc',
    );
  });
});
