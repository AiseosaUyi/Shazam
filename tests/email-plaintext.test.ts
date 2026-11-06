import { describe, it } from 'node:test';
import assert from 'node:assert';
import { markdownToPlain, buildRawMessage } from '@/lib/google/gmail';

describe('email markdown is flattened for plain-text sends', () => {
  it('strips bold, headings, code ticks and keeps words', () => {
    const out = markdownToPlain('# Update\n\n**Revenue** grew `10%`.\n* item one\n__Ask__: intro');
    assert.strictEqual(out, 'Update\n\nRevenue grew 10%.\n- item one\nAsk: intro');
  });
  it('keeps link targets visible', () => {
    assert.strictEqual(markdownToPlain('See [the deck](https://x.io/d)'), 'See the deck (https://x.io/d)');
  });
  it('does not mangle snake_case or math with asterisks', () => {
    assert.strictEqual(markdownToPlain('use my_var_name and 2*3*4'), 'use my_var_name and 2*3*4');
  });
  it('plain sends contain no ** after encoding; html sends are untouched', () => {
    const raw = (html: boolean) => Buffer.from(buildRawMessage({ to: ['a@b.co'], subject: 's', body: '**hi**', html }), 'base64url').toString();
    const decode = (m: string) => Buffer.from(m.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString();
    assert.strictEqual(decode(raw(false)), 'hi');
    assert.strictEqual(decode(raw(true)), '**hi**');
  });
});
