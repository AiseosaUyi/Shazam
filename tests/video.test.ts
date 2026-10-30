import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSrt, speechSpans } from '../src/lib/media/video';

describe('Video editing helpers', () => {
  it('groups word-level transcript tokens into short caption cues', () => {
    const words = 'Welcome to Gruve. Today we are launching our new events app'.split(' ').map((w, i) => ({ text: w, startSecond: i * 0.4, endSecond: i * 0.4 + 0.35 }));
    const srt = buildSrt(words);
    const cues = srt.trim().split('\n\n');
    assert.equal(cues[0].split('\n')[2], 'Welcome to Gruve.');
    assert.ok(cues.every((c) => c.split('\n')[2].split(' ').length <= 5));
    assert.match(cues[0], /00:00:00,000 --> 00:00:01,150/);
  });

  it('keeps speech between detected silences', () => {
    const log = '[silencedetect] silence_start: 0\n[silencedetect] silence_end: 2.5 | silence_duration: 2.5\n[silencedetect] silence_start: 7.6\n[silencedetect] silence_end: 10.2';
    assert.deepEqual(speechSpans(log, 10.2, 0), [[2.5, 7.6]]);
  });
});
