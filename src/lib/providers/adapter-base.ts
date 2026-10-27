import { Model, ProviderError, ProviderErrorType, Route, UsageNormalization } from '@/types/provider';

/**
 * Calculates estimated cost for text tasks based on token pricing schedule.
 */
export function calculateEstimatedCost(
  route: Route,
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens = 0
): number {
  const inputRate = route.pricing.inputPer1MTokensUSD / 1_000_000;
  const outputRate = route.pricing.outputPer1MTokensUSD / 1_000_000;
  const cacheRate = (route.pricing.cacheHitPer1MTokensUSD || route.pricing.inputPer1MTokensUSD) / 1_000_000;

  const cacheMissTokens = Math.max(0, promptTokens - cacheHitTokens);
  const cost = cacheMissTokens * inputRate + cacheHitTokens * cacheRate + completionTokens * outputRate;
  return Number(cost.toFixed(6));
}

/**
 * Normalizes HTTP status codes and error messages into standard ProviderError.
 */
export function standardErrorNormalizer(
  providerName: string,
  error: unknown,
  statusCode?: number
): ProviderError {
  if (error && typeof error === 'object' && 'type' in error && 'message' in error) {
    return error as ProviderError;
  }
  const message = error instanceof Error ? error.message : String(error);

  if (statusCode === 401 || message.includes('API key') || message.includes('Unauthorized') || message.includes('invalid_api_key')) {
    return {
      type: 'invalid_credentials',
      message: `Invalid or missing API key for ${providerName}. Please check your connection settings.`,
      statusCode: 401,
      retryable: false,
    };
  }

  if (statusCode === 403 || message.includes('PermissionDenied') || message.includes('AccessDenied')) {
    return {
      type: 'permission_denied',
      message: `Access denied by ${providerName}. Ensure your account has permissions for this model.`,
      statusCode: 403,
      retryable: false,
    };
  }

  if (statusCode === 429 || message.includes('Rate limit') || message.includes('RESOURCE_EXHAUSTED') || message.includes('too many requests')) {
    // Extract Retry-After if available
    let retryAfterSeconds = 15;
    const match = message.match(/retry after (\d+)s/i);
    if (match) retryAfterSeconds = parseInt(match[1], 10);

    return {
      type: 'rate_limited',
      message: `${providerName} rate limit reached. Attempting safe fallback.`,
      statusCode: 429,
      retryable: true,
      retryAfterSeconds,
    };
  }

  if (message.includes('quota') || message.includes('insufficient_quota') || message.includes('billing')) {
    return {
      type: 'quota_exhausted',
      message: `${providerName} account quota or balance exhausted.`,
      statusCode: statusCode || 402,
      retryable: false,
    };
  }

  if (statusCode === 503 || statusCode === 502 || message.includes('overloaded') || message.includes('unavailable')) {
    return {
      type: 'model_unavailable',
      message: `${providerName} service is currently unavailable or overloaded.`,
      statusCode,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  if (message.includes('timeout') || message.includes('ETIMEDOUT') || statusCode === 504) {
    return {
      type: 'timeout',
      message: `Request to ${providerName} timed out.`,
      statusCode: 504,
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  if (message.includes('content policy') || message.includes('safety') || message.includes('moderation')) {
    return {
      type: 'content_policy',
      message: `Content flagged by ${providerName} safety filters.`,
      statusCode: 400,
      retryable: false,
    };
  }

  return {
    type: 'provider_error',
    message: `${providerName} error: ${message}`,
    statusCode,
    retryable: (statusCode && statusCode >= 500) ? true : false,
    retryAfterSeconds: 5,
  };
}
