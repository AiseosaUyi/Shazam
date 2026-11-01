import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkProviderKey } from '@/lib/agent/models';
import { detectProviderFromKey, looksLikeCompleteKey } from '@/lib/providers/key-setup';

const realFetch = globalThis.fetch;
function mockFetch(status: number, body: unknown) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

describe('checkProviderKey: no fake "connected" (R0.1)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('rejects an invalid Gemini key (Google answers 400 API_KEY_INVALID, not 401)', async () => {
    mockFetch(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } });
    const r = await checkProviderKey('google', 'AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE123');
    assert.equal(r.ok, false);
  });

  it('rejects 401 keys for OpenAI-compatible providers', async () => {
    mockFetch(401, { error: 'invalid' });
    assert.equal((await checkProviderKey('groq', 'gsk_bogus')).ok, false);
  });

  it('validates OpenRouter keys against /key, since /models is public', async () => {
    const calls = mockFetch(401, { error: 'no auth' });
    const r = await checkProviderKey('openrouter', 'sk-or-v1-bogus');
    assert.equal(r.ok, false);
    assert.ok(calls[0].endsWith('/api/v1/key'));
  });

  it('accepts a valid key', async () => {
    mockFetch(200, { models: [{ name: 'a' }, { name: 'b' }] });
    const r = await checkProviderKey('google', 'AIzaREALREALREALREALREALREALREALREAL123');
    assert.deepEqual(r, { ok: true, models: 2 });
  });

  it('does not block saving on an unrelated provider outage', async () => {
    mockFetch(503, 'upstream down');
    assert.equal((await checkProviderKey('google', 'AIzaREALREALREALREALREALREALREALREAL123')).ok, true);
  });
});

describe('key format detection for auto-save on paste', () => {
  it('detects providers from key prefixes', () => {
    assert.equal(detectProviderFromKey('AIzaSyA1234567890abcdefghijklmnopqrstu'), 'google');
    assert.equal(detectProviderFromKey('gsk_abcdefghijklmnopqrstuvwxyz0123'), 'groq');
    assert.equal(detectProviderFromKey('sk-or-v1-0123456789abcdef0123456789abcdef'), 'openrouter');
    assert.equal(detectProviderFromKey('csk-abcdefghijklmnopqrstuvwxyz0123'), 'cerebras');
    assert.equal(detectProviderFromKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), 'anthropic');
    assert.equal(detectProviderFromKey('hello world'), null);
  });

  it('only auto-saves a complete key for the provider being set up', () => {
    assert.equal(looksLikeCompleteKey('google', 'AIzaSyA1234567890abcdefghijklmnopqrstu'), true);
    assert.equal(looksLikeCompleteKey('google', 'gsk_abcdefghijklmnopqrstuvwxyz0123'), false);
    assert.equal(looksLikeCompleteKey('google', 'AIza12'), false);
  });
});
