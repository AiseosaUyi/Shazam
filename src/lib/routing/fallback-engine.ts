import { DecisionTrace, DecisionTraceItem, TaskSpec } from '@/types/core';
import { ProviderError, Route } from '@/types/provider';
import { db } from '@/lib/db';
import { filterCandidates, FilterContext } from './candidate-filter';
import { ScoredCandidate, scoreCandidates } from './score-engine';

export interface FallbackDecision {
  nextRoute: Route;
  nextModelId: string;
  nextProviderId: string;
  fallbackReason: string;
  switchRationale: string;
  updatedDecisionTrace: DecisionTrace;
}

/**
 * Handles quota-aware and rate-limit fallback.
 * Strictly respects user policy: Free-Only will NEVER fall back to a paid or unknown route.
 */
export async function determineFallbackRoute(
  userId: string,
  taskSpec: TaskSpec,
  failedRouteId: string,
  error: ProviderError,
  existingTrace?: DecisionTrace,
  excludedRouteIds: string[] = []
): Promise<FallbackDecision | null> {
  // 1. Mark failed route in cooldown
  const cooldownDurationSec = error.retryAfterSeconds ?? (error.type === 'rate_limited' ? 30 : 60);
  await db.setRouteCooldown(failedRouteId, cooldownDurationSec);

  // 2. Load current system state
  const allRoutes = await db.getRoutes();
  const allModels = await db.getModels();
  const allProviders = await db.getProviders();
  const userCredentials = await db.getCredentialsForUser(userId);

  const modelMap = new Map(allModels.map((m) => [m.id, m]));
  const providerMap = new Map(allProviders.map((p) => [p.id, p]));
  const credentialMap = new Map(userCredentials.map((c) => [c.providerId, c]));

  const telemetryMap = new Map();
  for (const r of allRoutes) {
    const telem = await db.getRouteTelemetry(r.id);
    if (telem) telemetryMap.set(r.id, telem);
  }

  const systemKeysAvailable: Record<string, boolean> = {
    google: Boolean(process.env.GOOGLE_AI_API_KEY),
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    alibaba: Boolean(process.env.DASHSCOPE_API_KEY),
    simulation: true,
  };

  // Exclude current failed route and any previously failed routes
  const candidatesToConsider = allRoutes.filter(
    (r) => r.id !== failedRouteId && !excludedRouteIds.includes(r.id)
  );

  const filterContext: FilterContext = {
    taskSpec,
    models: modelMap,
    providers: providerMap,
    telemetry: telemetryMap,
    userCredentials: credentialMap,
    systemKeysAvailable,
  };

  // 3. Stage 1 Hard filter
  const { eligible, rejected } = filterCandidates(candidatesToConsider, filterContext);

  if (eligible.length === 0) {
    return null; // No remaining eligible fallback routes
  }

  // 4. Stage 2 Scoring
  const scored = scoreCandidates(eligible, taskSpec, telemetryMap);
  const bestCandidate: ScoredCandidate = scored[0];

  const failedModelName = modelMap.get(allRoutes.find((r) => r.id === failedRouteId)?.modelId || '')?.canonicalName || failedRouteId;
  const nextModelName = bestCandidate.model.canonicalName;

  const fallbackReason = `${error.type.replace('_', ' ').toUpperCase()}: ${error.message}`;
  const switchRationale = `Switched from ${failedModelName} to ${nextModelName} (${bestCandidate.route.costClass}) due to ${error.type}. Preserving conversation context under ${taskSpec.costPolicy.replace('_', ' ')} policy.`;

  const updatedTrace: DecisionTrace = {
    taskSpec,
    evaluatedRoutesCount: allRoutes.length,
    eligibleRoutesCount: eligible.length,
    candidates: [
      ...rejected.map((r) => r.traceItem),
      ...scored.map((s) => s.traceItem),
    ],
    selectedRouteId: bestCandidate.route.id,
    selectionRationale: switchRationale,
    timestamp: new Date().toISOString(),
  };

  return {
    nextRoute: bestCandidate.route,
    nextModelId: bestCandidate.model.id,
    nextProviderId: bestCandidate.provider.id,
    fallbackReason,
    switchRationale,
    updatedDecisionTrace: updatedTrace,
  };
}
