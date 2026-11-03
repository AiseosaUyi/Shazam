import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_NAME_RE, isValidModelName, recommendModel } from '@/lib/local-ai/recommend';

describe('recommendModel', () => {
  it('returns qwen3.6:35b-a3b (23 GB) for 64 GB RAM', () => {
    const res = recommendModel(64);
    assert.equal(res.model, 'qwen3.6:35b-a3b');
    assert.equal(res.sizeGB, 23);
  });

  it('returns qwen3.6:35b-a3b (23 GB) for exactly 48 GB RAM', () => {
    const res = recommendModel(48);
    assert.equal(res.model, 'qwen3.6:35b-a3b');
    assert.equal(res.sizeGB, 23);
  });

  it('returns qwen2.5-coder:14b (9 GB) for 47 GB RAM', () => {
    const res = recommendModel(47);
    assert.equal(res.model, 'qwen2.5-coder:14b');
    assert.equal(res.sizeGB, 9);
  });

  it('returns qwen2.5-coder:14b (9 GB) for exactly 24 GB RAM', () => {
    const res = recommendModel(24);
    assert.equal(res.model, 'qwen2.5-coder:14b');
    assert.equal(res.sizeGB, 9);
  });

  it('returns qwen2.5-coder:7b (4.7 GB) for 16 GB RAM', () => {
    const res = recommendModel(16);
    assert.equal(res.model, 'qwen2.5-coder:7b');
    assert.equal(res.sizeGB, 4.7);
  });

  it('returns qwen2.5-coder:3b (1.9 GB) for 8 GB RAM', () => {
    const res = recommendModel(8);
    assert.equal(res.model, 'qwen2.5-coder:3b');
    assert.equal(res.sizeGB, 1.9);
  });

  it('returns qwen2.5-coder:3b (1.9 GB) for NaN RAM', () => {
    const res = recommendModel(NaN);
    assert.equal(res.model, 'qwen2.5-coder:3b');
    assert.equal(res.sizeGB, 1.9);
  });

  it('returns qwen2.5-coder:3b (1.9 GB) for negative RAM', () => {
    const res = recommendModel(-1);
    assert.equal(res.model, 'qwen2.5-coder:3b');
    assert.equal(res.sizeGB, 1.9);
  });
});

describe('isValidModelName', () => {
  it('accepts "qwen3.6:35b-a3b"', () => {
    assert.ok(isValidModelName('qwen3.6:35b-a3b'));
  });

  it('accepts "llama3"', () => {
    assert.ok(isValidModelName('llama3'));
  });

  it('rejects empty string', () => {
    assert.strictEqual(isValidModelName(''), false);
  });

  it('rejects "a b" (space)', () => {
    assert.strictEqual(isValidModelName('a b'), false);
  });

  it('rejects "x;rm -rf /" (semicolons)', () => {
    assert.strictEqual(isValidModelName('x;rm -rf /'), false);
  });

  it('rejects "../etc" (path traversal)', () => {
    assert.strictEqual(isValidModelName('../etc'), false);
  });

  it('rejects "a:b:c" (multiple colons)', () => {
    assert.strictEqual(isValidModelName('a:b:c'), false);
  });

  it('rejects 101-character string', () => {
    assert.strictEqual(isValidModelName('a'.repeat(101)), false);
  });

  it('rejects non-string values (number)', () => {
    assert.strictEqual(isValidModelName(42 as any), false);
  });

  it('rejects non-string values (null)', () => {
    assert.strictEqual(isValidModelName(null as any), false);
  });

  it('rejects non-string values (undefined)', () => {
    assert.strictEqual(isValidModelName(undefined as any), false);
  });

  it('accepts valid model names with MODEL_NAME_RE', () => {
    assert.ok(MODEL_NAME_RE.test('qwen3.6:35b-a3b'));
    assert.ok(MODEL_NAME_RE.test('llama3'));
  });
});
