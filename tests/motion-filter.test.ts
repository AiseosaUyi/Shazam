import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMotionFilter, MOTION_SIZES } from '../src/lib/media/video';

describe('animate_image filter graph', () => {
  it('sizes every aspect and keeps the zoompan frame count in step with duration', () => {
    for (const [aspect, [w, h]] of Object.entries(MOTION_SIZES)) {
      const f = buildMotionFilter({ motion: 'zoom_in', aspect: aspect as keyof typeof MOTION_SIZES, seconds: 4 });
      assert.match(f, new RegExp(`zoompan=.*:d=120:s=${w}x${h}:fps=30`));
      assert.match(f, /fade=t=in/);
      assert.match(f, /fade=t=out:st=3\.40/);
      assert.match(f, /format=yuv420p$/);
    }
  });
  it('each motion kind produces a distinct movement', () => {
    const f = (m: Parameters<typeof buildMotionFilter>[0]['motion']) => buildMotionFilter({ motion: m, aspect: '1:1', seconds: 2 });
    assert.match(f('zoom_in'), /min\(zoom\+/);
    assert.match(f('zoom_out'), /max\(zoom-/);
    assert.match(f('pan_left'), /\(1-on\/60\)/);
    assert.match(f('pan_right'), /\*on\/60/);
    assert.match(f('none'), /z=1:/);
  });
  it('text comes from a file and never inline, so user text cannot reach the filter parser', () => {
    const f = buildMotionFilter({ motion: 'none', aspect: '9:16', seconds: 5, textFile: '/w/t.txt', fontFile: '/f/B.ttf' });
    assert.match(f, /drawtext=fontfile=\/f\/B\.ttf:textfile=\/w\/t\.txt/);
    assert.doesNotMatch(buildMotionFilter({ motion: 'none', aspect: '9:16', seconds: 5 }), /drawtext/);
  });
});

import { isMissingFilter } from '../src/lib/media/video';
describe('missing ffmpeg filter detection', () => {
  it('recognises a build without drawtext and ignores other failures', () => {
    assert.equal(isMissingFilter(new Error("ffmpeg step failed (exit 8): [AVFilterGraph @ 0x1] No such filter: 'drawtext'")), true);
    assert.equal(isMissingFilter(new Error('Error opening output files: Filter not found')), true);
    assert.equal(isMissingFilter(new Error('curl: (22) The requested URL returned error: 404')), false);
  });
});
