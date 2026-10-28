import type { ProviderError } from '@/lib/types';
import { redactSecrets } from '@/lib/crypto/vault';

export function normalizeProviderError(
  providerName: string,
  err: unknown,
  statusCode?: number
): ProviderError {
  let rawMsg = '';
  let providerDetail = '';
  let errorReason = '';

  if (err instanceof Error) {
    rawMsg = err.message;
    providerDetail = err.message;
  } else if (typeof err === 'string') {
    rawMsg = err;
    try {
      const parsed = JSON.parse(err);
      if (parsed?.error?.message) {
        providerDetail = parsed.error.message;
        if (parsed.error.details?.[0]?.reason) {
          errorReason = parsed.error.details[0].reason;
        }
      } else if (parsed?.message) {
        providerDetail = parsed.message;
      } else {
        providerDetail = err;
      }
    } catch {
      providerDetail = err;
    }
  } else if (typeof err === 'object' && err !== null) {
    const obj = err as any;
    if (obj.error?.message) {
      providerDetail = obj.error.message;
      rawMsg = obj.error.message;
      if (obj.error.details?.[0]?.reason) {
        errorReason = obj.error.details[0].reason;
      }
    } else if (obj.message) {
      providerDetail = obj.message;
      rawMsg = obj.message;
    } else {
      rawMsg = JSON.stringify(err);
      providerDetail = rawMsg;
    }
  } else {
    rawMsg = String(err);
    providerDetail = rawMsg;
  }

  const msg = redactSecrets(rawMsg);
  let cleanDetail = redactSecrets(providerDetail).trim();
  if (errorReason && !cleanDetail.includes(errorReason)) {
    cleanDetail = `${cleanDetail} (${errorReason})`;
  }

  const isAuthError =
    statusCode === 401 ||
    msg.includes('401') ||
    msg.includes('Unauthorized') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid_api_key') ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid') ||
    msg.includes('API key not found') ||
    msg.includes('Invalid API key') ||
    msg.includes('unregistered callers') ||
    msg.includes('consumer identity') ||
    msg.includes('API key expired') ||
    (statusCode === 400 && (msg.includes('API key') || msg.includes('API_KEY') || msg.includes('INVALID_ARGUMENT')));

  if (isAuthError) {
    const detailMsg = cleanDetail && cleanDetail !== 'Execution failed' && cleanDetail !== 'fetch failed' && !cleanDetail.startsWith('{')
      ? cleanDetail
      : 'Please connect a valid API key in Connections.';
    return {
      type: 'invalid_credentials',
      message: `Invalid or missing API key for ${providerName}: ${detailMsg}`,
      statusCode: 401,
      retryable: false,
    };
  }

  if (
    statusCode === 403 ||
    msg.includes('403') ||
    msg.includes('PermissionDenied') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('AccessDenied') ||
    msg.includes('not have permission') ||
    msg.includes('has not been used in project') ||
    msg.includes('User location is not supported')
  ) {
    return {
      type: 'permission_denied',
      message: cleanDetail && cleanDetail.length > 5 && !cleanDetail.startsWith('{')
        ? `Access denied by ${providerName}: ${cleanDetail}`
        : `Access denied by ${providerName}. Check account tier and model permissions.`,
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

  if (
    statusCode === 503 ||
    statusCode === 502 ||
    msg.includes('overloaded') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('fetch failed') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNREFUSED')
  ) {
    return {
      type: 'model_unavailable',
      message: `${providerName} service is overloaded or unavailable.`,
      statusCode: statusCode || 503,
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

  const detailSnippet = cleanDetail && cleanDetail.length > 0 && cleanDetail !== msg && !cleanDetail.startsWith('{')
    ? cleanDetail
    : msg;

  const displayMessage =
    detailSnippet && detailSnippet !== '[object Object]' && detailSnippet.length < 300 && !detailSnippet.startsWith('{')
      ? `${providerName} returned: ${detailSnippet}`
      : `${providerName} returned an error.`;

  return {
    type: 'provider_error',
    message: displayMessage,
    statusCode,
    retryable: (statusCode && statusCode >= 500) ? true : false,
    retryAfterSeconds: 5,
  };
}
