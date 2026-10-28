// src/lib/execution/adapters/model-resolver.ts

/**
 * Maps futuristic/catalog model identifiers to active, real-time live upstream provider model IDs.
 * Prevents 30+ second provider gateway resolution hangs on non-existent model strings.
 */
export function resolveLiveProviderModel(providerId: string, catalogModelId: string): string {
  const id = (catalogModelId || '').toLowerCase().trim();

  switch (providerId) {
    case 'google':
      if (id.includes('flash-lite') || id === 'gemini-3.5-flash-lite') {
        return 'gemini-3.5-flash-lite';
      }
      if (id.includes('flash') || id === 'gemini-3.8-flash') {
        return 'gemini-3.8-flash';
      }
      if (id.includes('argon') || id.includes('pro') || id === 'gemini-4-argon') {
        return 'gemini-3.1-pro-preview';
      }
      return 'gemini-3.8-flash';

    case 'openai':
      if (id.includes('luna')) return 'gpt-4o-mini';
      if (id.includes('sol')) return 'o3-mini';
      if (id.includes('terra') || id.includes('astra')) return 'gpt-4o';
      return 'gpt-4o';

    case 'anthropic':
      if (id.includes('sonnet')) return 'claude-3-5-sonnet-20241022';
      if (id.includes('haiku')) return 'claude-3-5-haiku-20241022';
      if (id.includes('opus')) return 'claude-3-opus-20240229';
      return 'claude-3-5-sonnet-20241022';

    case 'deepseek':
      if (id.includes('flash') || id.includes('chat')) return 'deepseek-chat';
      if (id.includes('pro') || id.includes('reasoner') || id.includes('v4')) return 'deepseek-reasoner';
      return 'deepseek-chat';

    default:
      return catalogModelId;
  }
}

/**
 * Creates an AbortSignal that aborts if either the parent signal aborts or the timeout elapses.
 */
export function createTimeoutSignal(parentSignal?: AbortSignal, timeoutMs = 15000): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Upstream provider request timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
  }, timeoutMs);

  function onParentAbort() {
    controller.abort(parentSignal?.reason);
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    },
  };
}
