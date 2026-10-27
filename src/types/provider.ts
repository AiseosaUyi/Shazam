import { AccessMode, CostClass, Modality, QuotaConfidence, RouteStatus } from './core';

export interface Provider {
  id: string;
  name: string;
  category: 'direct' | 'aggregator' | 'cloud' | 'local';
  officialDocsUrl: string;
  termsUrl: string;
  pricingUrl: string;
  status: 'enabled' | 'degraded' | 'disabled';
  requiresApiKey: boolean;
  keyInstructionsUrl?: string;
  lastVerifiedAt: string;
}

export interface ProviderCredential {
  id: string;
  userId: string;
  providerId: string;
  encryptedKey: string;
  keyPrefix: string; // e.g. "sk-...12ab" for safe UI display
  keyVersion: number;
  status: 'valid' | 'invalid' | 'revoked' | 'untested';
  createdAt: string;
  lastValidatedAt?: string;
}

export interface Model {
  id: string;
  providerId: string;
  canonicalName: string;
  providerModelId: string;
  modalities: Modality[];
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  supportsReasoningExtraction?: boolean;
  license: string;
  qualityScores: {
    writing: number;
    general_chat: number;
    reasoning: number;
    planning: number;
    coding: number;
    document_analysis: number;
    vision: number;
  };
  lastVerifiedAt: string;
}

export interface RoutePricing {
  inputPer1MTokensUSD: number;
  outputPer1MTokensUSD: number;
  cacheHitPer1MTokensUSD?: number;
  perImageUSD?: number;
  perMinuteAudioUSD?: number;
  perMinuteVideoUSD?: number;
}

export interface Route {
  id: string;
  modelId: string;
  providerId: string;
  endpointUrl?: string;
  region: string;
  accessMode: AccessMode;
  costClass: CostClass;
  pricing: RoutePricing;
  quotaSource: 'provider_api' | 'headers' | 'locally_estimated' | 'opaque';
  quotaConfidence: QuotaConfidence;
  rateLimitRPM?: number;
  rateLimitTPM?: number;
  status: RouteStatus;
  termsStatus: 'approved' | 'pending' | 'restricted';
  privacyPolicy: {
    dataRetentionDays: number;
    allowsModelTraining: boolean;
    regionEnforced: boolean;
  };
  lastVerifiedAt: string;
  officialDocReference: string;
}

export interface QuotaSnapshot {
  id: string;
  routeId: string;
  providerId: string;
  userId?: string;
  remainingRequests?: number;
  remainingTokens?: number;
  resetAt?: string;
  observedAt: string;
  source: 'provider_api' | 'headers' | 'locally_estimated' | 'opaque';
  confidence: QuotaConfidence;
  rawHeaders?: Record<string, string>;
}

export type ProviderErrorType =
  | 'invalid_credentials'
  | 'permission_denied'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'model_unavailable'
  | 'unsupported_capability'
  | 'timeout'
  | 'content_policy'
  | 'provider_error'
  | 'unknown';

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryAfterSeconds?: number;
  rawDetails?: unknown;
}

export interface UsageNormalization {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  estimatedCostUSD: number;
  providerReportedCostUSD?: number;
}

export interface StreamChunk {
  type: 'delta' | 'reasoning' | 'status' | 'usage' | 'error';
  deltaText?: string;
  reasoningText?: string;
  usage?: UsageNormalization;
  error?: ProviderError;
}

export interface ExecutionRequest {
  taskId: string;
  route: Route;
  model: Model;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  attachments?: Array<{ name: string; mimeType: string; content: string }>;
  apiKey?: string;
}

export interface ProviderAdapter {
  providerId: string;
  validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }>;
  estimateCost(model: Model, route: Route, promptTokens: number, expectedOutputTokens: number): number;
  generateText(request: ExecutionRequest): Promise<{ text: string; usage: UsageNormalization }>;
  streamText(
    request: ExecutionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<{ fullText: string; usage: UsageNormalization }>;
  normalizeError(error: unknown, statusCode?: number): ProviderError;
  healthCheck(route: Route): Promise<{ healthy: boolean; latencyMs: number }>;
}
