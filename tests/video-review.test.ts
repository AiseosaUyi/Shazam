import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { videoReviewNotes } from '@/lib/media/review';

describe('videoReviewNotes', () => {
  it('0.4 s contains "under 1 second"', () => {
    const result = videoReviewNotes(0.4, []);
    assert.ok(result.includes('under 1 second'), 'Expected output to mention under 1 second');
  });

  it('NaN contains "under 1 second"', () => {
    const result = videoReviewNotes(NaN, []);
    assert.ok(result.includes('under 1 second'), 'Expected NaN to trigger under 1 second warning');
  });

  it('12 s with a captions op contains "transcribe_video" and not "under 1 second"', () => {
    const ops = [{ op: 'captions' }];
    const result = videoReviewNotes(12, ops);
    assert.ok(result.includes('transcribe_video'), 'Expected captions to mention transcribe_video');
    assert.ok(!result.includes('under 1 second'), 'Expected valid duration to not trigger under 1 second warning');
  });

  it('reframe 9:16 contains "9:16"', () => {
    const ops = [{ op: 'reframe', aspect: '9:16' }];
    const result = videoReviewNotes(12, ops);
    assert.ok(result.includes('9:16'), 'Expected reframe to mention the aspect ratio');
  });

  it('trim end <= start contains "end ≤ start"', () => {
    const ops = [{ op: 'trim', start: 5, end: 3 }];
    const result = videoReviewNotes(12, ops);
    assert.ok(result.includes('end \u2264 start'), 'Expected trim with end <= start to show the warning');
  });

  it('always ends with "at most 2 more renders" bullet', () => {
    const result = videoReviewNotes(12, []);
    const lastLine = result.split('\n').filter(Boolean).pop()!;
    assert.ok(lastLine.includes('at most 2 more renders'), 'Expected last bullet to mention at most 2 more renders');
  });

  it('plain 12 s mute-only edit has only header and final bullet', () => {
    const ops = [{ op: 'mute' }];
    const result = videoReviewNotes(12, ops);
    const lines = result.split('\n').filter((l) => l.trim());
    // Should be exactly 2 lines: the header + the final bullet
    assert.strictEqual(lines.length, 2, `Expected exactly 2 lines for mute-only edit, got ${lines.length}: ${JSON.stringify(lines)}`);
    assert.ok(lines[0].startsWith('Review before you report'), 'First line should be the header');
    assert.ok(lines[1].includes('at most 2 more renders'), 'Last line should be the final bullet');
  });
});
