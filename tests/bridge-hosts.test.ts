import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostsFromPrompt } from '../src/lib/bridge/tools';

describe('hostsFromPrompt', () => {
  it('extracts a domain with https and path, strips www', () => {
    const result = hostsFromPrompt('go to https://www.gruve.events/home and click');
    assert.deepEqual(result, ['gruve.events']);
  });

  it('extracts bare domain (no protocol) and ignores file extensions in paths', () => {
    const result = hostsFromPrompt('open the-internet.herokuapp.com/upload, attach notes.pdf and README.md');
    assert.deepEqual(result, ['the-internet.herokuapp.com']);
  });

  it('excludes email-local domains but keeps other subdomains', () => {
    const result = hostsFromPrompt('email me at a@b.com about jobs.micro1.ai');
    assert.ok(!result.includes('b.com'), 'should not include email domain b.com');
    assert.deepEqual(result, ['jobs.micro1.ai']);
  });

  it('returns empty when no sites are found', () => {
    const result = hostsFromPrompt('no sites here');
    assert.deepEqual(result, []);
  });
});
