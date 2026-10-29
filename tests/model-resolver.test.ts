import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveLiveProviderModel, createTimeoutSignal } from '../src/lib/execution/adapters/model-resolver';

describe('Live Upstream Provider Model Resolver Tests', () => {
  test('maps Google catalog models to live Gemini endpoints', () => {
    assert.strictEqual(resolveLiveProviderModel('google', 'gemini-3.8-flash'), 'gemini-3.5-flash-lite');
    assert.strictEqual(resolveLiveProviderModel('google', 'gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite');
    assert.strictEqual(resolveLiveProviderModel('google', 'gemini-4-argon'), 'gemini-3.1-pro-preview');
  });

  test('maps OpenAI catalog models to active endpoints', () => {
    assert.strictEqual(resolveLiveProviderModel('openai', 'gpt-6.1-terra'), 'gpt-4o');
    assert.strictEqual(resolveLiveProviderModel('openai', 'gpt-6-luna'), 'gpt-4o-mini');
    assert.strictEqual(resolveLiveProviderModel('openai', 'gpt-6.1-sol'), 'o3-mini');
  });

  test('maps Anthropic and DeepSeek models to active endpoints', () => {
    assert.strictEqual(resolveLiveProviderModel('anthropic', 'claude-sonnet-5-5'), 'claude-3-5-sonnet-20241022');
    assert.strictEqual(resolveLiveProviderModel('deepseek', 'deepseek-flash'), 'deepseek-chat');
    assert.strictEqual(resolveLiveProviderModel('deepseek', 'deepseek-v4-pro'), 'deepseek-reasoner');
  });

  test('createTimeoutSignal aborts after timeout', async () => {
    const { signal, cleanup } = createTimeoutSignal(undefined, 50);
    assert.strictEqual(signal.aborted, false);
    await new Promise((r) => setTimeout(r, 70));
    assert.strictEqual(signal.aborted, true);
    cleanup();
  });
});
