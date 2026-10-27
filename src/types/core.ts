/**
 * Shazam AI — Core Domain Types
 */

export type TaskClass =
  | 'writing'
  | 'general_chat'
  | 'reasoning'
  | 'planning'
  | 'coding'
  | 'document_analysis'
  | 'vision'
  | 'image_generation'
  | 'video_generation'
  | 'audio';

export type Modality =
  | 'text'
  | 'code'
  | 'image'
  | 'audio'
  | 'video'
  | 'document';

export type CostPolicy =
  | 'free_only'
  | 'lowest_cost'
  | 'balanced'
  | 'best_quality'
  | 'manual_pin';

export type CostClass =
  | 'verified_free'
  | 'user_allowance'
  | 'paid'
  | 'local_compute'
  | 'unknown';

export type QuotaConfidence =
  | 'observed'
  | 'estimated'
  | 'unknown';

export type RouteStatus =
  | 'enabled'
  | 'degraded'
  | 'cooldown'
  | 'exhausted'
  | 'unknown'
  | 'disabled';

export type AccessMode =
  | 'direct_api'
  | 'aggregator'
  | 'byok'
  | 'local'
  | 'managed_pool';

export interface TaskAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content?: string; // base64 or text
  storageKey?: string;
}

export interface TaskSpec {
  taskClass: TaskClass;
  inputModalities: Modality[];
  outputModality: Modality;
  requiredCapabilities: string[];
  contextEstimateTokens: number;
  qualityFloor?: number;
  privacySensitivity: 'standard' | 'high' | 'strict';
  costPolicy: CostPolicy;
  maxCostUSD?: number;
  allowedProviders?: string[];
  disallowedProviders?: string[];
  preferredRegion?: string;
  pinnedRouteId?: string;
  requiresTools?: boolean;
  intentSummary?: string;
}

export interface DecisionTraceItem {
  routeId: string;
  modelId: string;
  providerId: string;
  status: 'eligible' | 'filtered_out';
  filterRejectionReason?: string;
  score?: number;
  scoreBreakdown?: {
    quality: number;
    health: number;
    latency: number;
    cost: number;
    quotaConfidence: number;
    privacy: number;
  };
}

export interface DecisionTrace {
  taskSpec: TaskSpec;
  evaluatedRoutesCount: number;
  eligibleRoutesCount: number;
  candidates: DecisionTraceItem[];
  selectedRouteId: string;
  selectionRationale: string;
  timestamp: string;
}

export type TaskLifecycleState =
  | 'created'
  | 'classified'
  | 'routing'
  | 'running'
  | 'streaming'
  | 'retry_wait'
  | 'waiting_for_user_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface RouteTelemetry {
  routeId: string;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRateWindow: number; // 0.0 - 1.0
  consecutiveErrors: number;
  cooldownUntil?: string;
  lastHealthCheck: string;
  isHealthy: boolean;
}
