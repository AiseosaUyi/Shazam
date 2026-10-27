import { CostPolicy, DecisionTrace, Modality, TaskAttachment, TaskClass, TaskLifecycleState, TaskSpec } from './core';
import { ProviderError, UsageNormalization } from './provider';

export interface TaskAttempt {
  attemptNumber: number;
  routeId: string;
  modelId: string;
  providerId: string;
  startedAt: string;
  completedAt?: string;
  state: 'running' | 'succeeded' | 'failed';
  error?: ProviderError;
  fallbackReason?: string;
  usage?: UsageNormalization;
}

export interface Task {
  id: string;
  userId: string;
  conversationId?: string;
  title?: string;
  prompt: string;
  attachments: TaskAttachment[];
  taskClass: TaskClass;
  taskSpec: TaskSpec;
  costPolicy: CostPolicy;
  status: TaskLifecycleState;
  decisionTrace?: DecisionTrace;
  selectedRouteId?: string;
  selectedModelId?: string;
  selectedProviderId?: string;
  currentAttempt: number;
  attempts: TaskAttempt[];
  responseOutput?: string;
  reasoningOutput?: string;
  totalEstimatedCostUSD: number;
  totalActualCostUSD?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type TaskEventType =
  | 'task_created'
  | 'task_classified'
  | 'route_selected'
  | 'execution_started'
  | 'delta'
  | 'reasoning'
  | 'fallback_started'
  | 'task_succeeded'
  | 'task_failed'
  | 'task_cancelled';

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  timestamp: string;
  data: {
    message?: string;
    taskSpec?: TaskSpec;
    routeId?: string;
    modelId?: string;
    providerId?: string;
    rationale?: string;
    deltaText?: string;
    reasoningText?: string;
    error?: ProviderError;
    usage?: UsageNormalization;
  };
}

export interface UsageEvent {
  id: string;
  taskId: string;
  userId: string;
  providerId: string;
  modelId: string;
  routeId: string;
  taskClass: TaskClass;
  costPolicy: CostPolicy;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  providerReportedCostUSD?: number;
  status: 'succeeded' | 'failed' | 'fallback_relegated';
  createdAt: string;
}
