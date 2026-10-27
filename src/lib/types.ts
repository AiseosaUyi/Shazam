/** Shazam AI shared domain types. */

export type TaskClass =
  | 'general_chat'
  | 'writing'
  | 'reasoning'
  | 'planning'
  | 'coding'
  | 'document_analysis'
  | 'vision'
  | 'image_generation'
  | 'video_generation'
  | 'audio';

export const TASK_CLASSES: TaskClass[] = [
  'general_chat', 'writing', 'reasoning', 'planning', 'coding',
  'document_analysis', 'vision', 'image_generation', 'video_generation', 'audio',
];

export type Modality = 'text' | 'image' | 'audio' | 'video' | 'document';
export type OutputModality = 'text' | 'image' | 'audio' | 'video';

export type CostPolicy = 'free_only' | 'lowest_cost' | 'balanced' | 'best_quality' | 'manual_pin';
export const COST_POLICIES: CostPolicy[] = ['balanced', 'free_only', 'lowest_cost', 'best_quality', 'manual_pin'];

export type CostClass = 'verified_free' | 'user_allowance' | 'paid' | 'local_compute' | 'unknown';
export type QuotaConfidence = 'observed' | 'estimated' | 'unknown';
export type PrivacyMode = 'standard' | 'strict';

export interface Provider {
  id: string;
  name: string;
  category: 'direct' | 'aggregator' | 'demo';
  docsUrl: string;
  pricingUrl: string;
  termsUrl: string;
  keyUrl?: string;
  keyEnvVar?: string;
  requiresApiKey: boolean;
  /** 'verified' = docs reviewed and adapter contract implemented; 'unverified' routes are never routable. */
  verification: 'verified' | 'unverified';
  defaultStatus: 'enabled' | 'disabled';
  notes?: string;
}

export interface Model {
  id: string;
  providerId: string;
  name: string;
  providerModelId: string;
  description?: string;
  inputModalities: Modality[];
  outputModality: OutputModality;
  /** null when the provider's docs did not state it; the router then cannot hard-filter on it. */
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean;
  supportsReasoning: boolean;
  /** Internal prior (1-5) used only for ranking. NOT a benchmark score; shown as "prior" in traces. */
  qualityTier: number;
  strengths: TaskClass[];
}

export interface RoutePricing {
  inputPer1M: number;
  outputPer1M: number;
  note?: string;
}

export interface Route {
  id: string;
  modelId: string;
  providerId: string;
  costClass: CostClass;
  /** null when the cost is unknown. */
  pricing: RoutePricing | null;
  quotaConfidence: QuotaConfidence;
  quotaNote?: string;
  privacy: { providerMayTrainOnData: boolean | 'unknown'; note?: string };
  defaultStatus: 'enabled' | 'disabled';
  disabledReason?: string;
  verifiedAt: string;
  sourceUrl: string;
  dynamic?: boolean;
}

export interface CatalogRoute extends Route {
  status: 'enabled' | 'disabled';
  statusReason?: string;
}

export interface Catalog {
  providers: (Provider & { status: 'enabled' | 'disabled' })[];
  models: Model[];
  routes: CatalogRoute[];
  dynamicSyncedAt?: string | null;
}

export interface TaskSpec {
  taskClass: TaskClass;
  inputModalities: Modality[];
  outputModality: OutputModality;
  requiredCapabilities: ('tools' | 'reasoning')[];
  contextEstimateTokens: number;
  expectedOutputTokens: number;
  privacyMode: PrivacyMode;
  costPolicy: CostPolicy;
  maxCostUSD: number;
  monthlyBudgetRemainingUSD: number;
  allowedProviders: string[] | null;
  pinnedRouteId: string | null;
  classifierConfidence: 'keyword' | 'user_override' | 'default';
}

export interface DecisionCandidate {
  routeId: string;
  modelId: string;
  providerId: string;
  costClass: CostClass;
  eligible: boolean;
  rejection?: string;
  score?: number;
  breakdown?: Record<string, number>;
  estimatedCostUSD?: number | null;
}

export interface DecisionTrace {
  policyVersion: string;
  taskSpec: TaskSpec;
  evaluated: number;
  eligible: number;
  candidates: DecisionCandidate[];
  selectedRouteId: string | null;
  rationale: string;
  createdAt: string;
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
  | 'cancelled'
  | 'unknown';

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  tokensKind: 'provider_reported' | 'estimated';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  type: 'delta' | 'reasoning';
  text: string;
}

export interface TaskAttempt {
  attempt: number;
  routeId: string;
  modelId: string;
  providerId: string;
  startedAt: string;
  completedAt?: string;
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  error?: ProviderError;
  usage?: Usage;
  costUSD?: number | null;
  latencyMs?: number;
}

export type TaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  status: TaskStatus;
  taskClass: TaskClass;
  costPolicy: CostPolicy;
  prompt: string;
  response: string | null;
  reasoning: string | null;
  routeId: string | null;
  modelId: string | null;
  providerId: string | null;
  decisionTrace: DecisionTrace | null;
  attempts: TaskAttempt[];
  costUSD: number;
  costKind: 'estimated' | 'unknown' | 'zero';
  error: ProviderError | null;
  createdAt: string;
  completedAt: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  onboarded: boolean;
  createdAt: string;
}

export interface UserPreferences {
  defaultCostPolicy: CostPolicy;
  maxCostPerTaskUSD: number;
  monthlyBudgetUSD: number;
  privacyMode: PrivacyMode;
  retentionDays: number;
  allowedProviders: string[] | null;
  preferredRegion: string | null;
  autoFallbackEnabled: boolean;
  allowPaidFallback: boolean;
  updatedAt: string;
}

/** Events streamed to the client over SSE while a task runs. */
export type TaskEvent =
  | { type: 'task_created'; taskId: string; conversationId: string; taskClass: TaskClass }
  | { type: 'route_selected'; routeId: string; modelId: string; providerId: string; modelName: string; providerName: string; costClass: CostClass; rationale: string; attempt: number }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'fallback'; fromRouteId: string; toRouteId: string; toModelName: string; reason: string; errorType: ProviderErrorType }
  | { type: 'done'; task: TaskRecord }
  | { type: 'error'; error: ProviderError; task?: TaskRecord; hint?: string };

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  rootDir: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  updatedAt: string;
  projectId?: string;
}

