import { CostPolicy } from './core';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: string;
  status: 'active' | 'suspended';
}

export interface UserPreference {
  userId: string;
  defaultCostPolicy: CostPolicy;
  maxCostPerTaskUSD: number;
  monthlyBudgetUSD: number;
  privacyMode: 'standard' | 'high' | 'strict';
  allowedProviders?: string[];
  disallowedProviders?: string[];
  preferredRegion?: string;
  autoFallbackEnabled: boolean;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  timestamp: string;
  outcome: 'success' | 'failure';
  metadata?: Record<string, unknown>;
}
