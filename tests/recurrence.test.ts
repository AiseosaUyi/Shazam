import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, zonedTimeToUtc } from '../src/lib/jobs/recurrence';

describe('Scheduled job recurrence', () => {
  it('converts Lagos wall-clock 9am to UTC 8am', () => {
    assert.equal(zonedTimeToUtc(2026, 11, 2, 9, 0, 'Africa/Lagos').toISOString(), '2026-11-02T08:00:00.000Z');
  });
  it('keeps 9am New York across the DST change', () => {
    // Friday 30 Oct 2026 09:00 EDT (13:00Z) → next weekly is Fri 6 Nov 09:00 EST (14:00Z)
    const next = nextOccurrence('2026-10-30T13:00:00.000Z', 'weekly', 'America/New_York', new Date('2026-10-30T13:01:00Z'));
    assert.equal(next, '2026-11-06T14:00:00.000Z');
  });
  it('skips weekends for weekdays recurrence', () => {
    // Friday 2026-10-30 09:00 Lagos → Monday 2026-11-02 09:00 Lagos
    const next = nextOccurrence('2026-10-30T08:00:00.000Z', 'weekdays', 'Africa/Lagos', new Date('2026-10-30T08:01:00Z'));
    assert.equal(next, '2026-11-02T08:00:00.000Z');
  });
  it('returns null for one-off jobs', () => {
    assert.equal(nextOccurrence('2026-10-30T08:00:00.000Z', null), null);
  });
});

describe('Monthly recurrence', () => {
  it('runs on the 31st when the month has one and the last day otherwise', () => {
    const nov = nextOccurrence('2026-10-31T08:00:00.000Z', 'monthly', 'UTC', new Date('2026-10-31T08:01:00Z'));
    assert.equal(nov, '2026-11-30T08:00:00.000Z');
  });
});
