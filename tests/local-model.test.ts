import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLocalModel, withLocalDefaults, LOCAL_MAX_OUTPUT_TOKENS } from '@/lib/agent/local-llm';
import { localLeads } from '@/lib/agent/resolve';
import { isRetryableModelError } from '@/lib/agent/fallback';

const m = (id: string) => ({ server: 'ollama' as const, id });

describe('Local models', () => {
  it('turns thinking on by default, off on the fast retry, and caps output', () => {
    const on = JSON.parse(withLocalDefaults(JSON.stringify({ model: 'q', messages: [] }), 'on')!);
    assert.equal(on.reasoning_effort, 'high');
    assert.equal(on.max_tokens, LOCAL_MAX_OUTPUT_TOKENS);
    const off = JSON.parse(withLocalDefaults(JSON.stringify({ model: 'q', reasoning_effort: 'high', max_tokens: 500 }), 'off')!);
    assert.equal(off.reasoning_effort, 'none');
    assert.equal(off.max_tokens, 500, 'a caller-set cap is kept');
    assert.equal(withLocalDefaults('not json', 'on'), 'not json');
    assert.equal(withLocalDefaults(undefined, 'on'), undefined);
  });

  it('prefers Arcwork-configured and strong models, and skips tiny ones', () => {
    assert.equal(pickLocalModel([m('llama3.2:3b'), m('qwen3.6:35b-a3b'), m('arcwork-qwen3.6')])?.id, 'arcwork-qwen3.6');
    assert.equal(pickLocalModel([m('llama3.2:3b'), m('qwen3.6:35b-a3b'), m('gpt-oss:20b')])?.id, 'qwen3.6:35b-a3b');
    assert.equal(pickLocalModel([m('qwen2.5-coder:1.5b'), m('nomic-embed-text')]), null, 'too small and embeddings never lead');
    assert.equal(pickLocalModel([m('gemma4:e4b'), m('qwen2.5:0.5b')])?.id, 'gemma4:e4b', 'small models lead only when nothing bigger exists');
    assert.equal(pickLocalModel([]), null);
  });

  it('leads by default, follows a pin, and respects turning it off', () => {
    assert.equal(localLeads(null), true);
    assert.equal(localLeads('local'), true);
    assert.equal(localLeads('gemini-3.8-flash'), false);
    assert.equal(localLeads(null, { preferLocalModel: false }), false);
  });

  it('treats timeouts and busy models as reasons to switch to the next free model', () => {
    assert.equal(isRetryableModelError(Object.assign(new Error('local model timed out (qwen3.6)'), { statusCode: 504 })), true);
    assert.equal(isRetryableModelError(new Error('Request timed out')), true);
    assert.equal(isRetryableModelError(new Error('This model is currently experiencing high demand.')), true);
    assert.equal(isRetryableModelError(Object.assign(new Error('Invalid tool schema'), { statusCode: 400 })), false);
  });
});
