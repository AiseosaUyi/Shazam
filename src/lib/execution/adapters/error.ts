import type { ProviderError } from '@/lib/types';
import { redactSecrets } from '@/lib/crypto/vault';

export function normalizeProviderError(
  providerName: string,
  err: unknown,
  statusCode?: number
): ProviderError {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = redactSecrets(rawMsg);

  if (
    statusCode === 401 ||
    msg.includes('401') ||
    msg.includes('Unauthorized') ||
    msg.includes('invalid_api_key') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid') ||
    msg.includes('API key not found') ||
    (statusCode === 400 && (msg.includes('API key') || msg.includes('INVALID_ARGUMENT')))
  ) {
    return {
      type: 'invalid_credentials',
      message: `Invalid or missing API key for ${providerName}. Please connect a valid API key in Connections.`,
      statusCode: 401,
      retryable: false,
    };
  }

  if (statusCode === 403 || msg.includes('403') || msg.includes('PermissionDenied') || msg.includes('AccessDenied')) {
    return {
      type: 'permission_denied',
      message: `Access denied by ${providerName}. Check account tier and model permissions.`,
      statusCode: 403,
      retryable: false,
    };
  }

  if (statusCode === 429 || msg.includes('429') || msg.includes('rate_limit') || msg.includes('RESOURCE_EXHAUSTED')) {
    let retryAfterSeconds = 30;
    const match = msg.match(/retry after (\d+)/i);
    if (match) retryAfterSeconds = parseInt(match[1], 10);

    return {
      type: 'rate_limited',
      message: `${providerName} rate limit reached. Attempting safe fallback.`,
      statusCode: 429,
      retryable: true,
      retryAfterSeconds,
    };
  }

  if (msg.includes('insufficient_quota') || msg.includes('billing') || msg.includes('credit balance') || statusCode === 402) {
    return {
      type: 'quota_exhausted',
      message: `${providerName} quota or account balance exhausted.`,
      statusCode: 402,
      retryable: false,
    };
  }

  if (msg.includes('safety') || msg.includes('content policy') || msg.includes('moderation') || msg.includes('flagged')) {
    return {
      type: 'content_policy',
      message: `Request was flagged by ${providerName} content policy.`,
      statusCode: 400,
      retryable: false,
    };
  }

  if (statusCode === 503 || statusCode === 502 || msg.includes('overloaded') || msg.includes('temporarily unavailable')) {
    return {
      type: 'model_unavailable',
      message: `${providerName} service is overloaded or unavailable.`,
      statusCode,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  if (msg.includes('timeout') || msg.includes('AbortError') || statusCode === 504) {
    return {
      type: 'timeout',
      message: `Request to ${providerName} timed out.`,
      statusCode: 504,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  return {
    type: 'provider_error',
    message: `${providerName} returned an error.`,
    statusCode,
    retryable: (statusCode && statusCode >= 500) ? true : false,
    retryAfterSeconds: 5,
  };
}
