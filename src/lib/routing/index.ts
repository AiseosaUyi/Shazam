import { DecisionTrace, TaskAttachment, TaskSpec } from '@/types/core';
import { Model, Provider, Route } from '@/types/provider';
import { db } from '@/lib/db';
import { classifyTask } from './classifier';
import { filterCandidates, FilterContext } from './candidate-filter';
import { scoreCandidates, ScoredCandidate } from './score-engine';

export interface RouteResolution {
  taskSpec: TaskSpec;
  selectedRoute: Route;
  selectedModel: Model;
  selectedProvider: Provider;
  decisionTrace: DecisionTrace;
  selectionRationale: string;
}

export async function resolveRouteForTask(
  userId: string,
  prompt: string,
  attachments: TaskAttachment[] = [],
  policyOverride?: any,
  pinnedRouteId?: string
): Promise<RouteResolution> {
  const userPref = await db.getUserPreference(userId);
  const taskSpec = classifyTask(prompt, attachments, userPref, policyOverride, pinnedRouteId);

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

  const filterContext: FilterContext = {
    taskSpec,
    models: modelMap,
    providers: providerMap,
    telemetry: telemetryMap,
    userCredentials: credentialMap,
    systemKeysAvailable,
  };

  // 1. Stage 1 Hard Filter
  const { eligible, rejected } = filterCandidates(allRoutes, filterContext);

  if (eligible.length === 0) {
    const rejectionDetails = rejected
      .map((r) => `${r.route.id}: ${r.rejectionReason}`)
      .join('; ');
    throw new Error(
      `No eligible routes found for this task under the "${taskSpec.costPolicy.replace('_', ' ')}" policy. Rejection details: ${rejectionDetails}`
    );
  }

  // 2. Stage 2 Scoring
  const scored = scoreCandidates(eligible, taskSpec, telemetryMap);
  const topCandidate: ScoredCandidate = scored[0];

  const selectionRationale = `Selected ${topCandidate.model.canonicalName} via ${topCandidate.provider.name} (${topCandidate.route.costClass}). Score: ${topCandidate.score.toFixed(3)} [Quality: ${topCandidate.scoreBreakdown.quality}, Cost: ${topCandidate.scoreBreakdown.cost}, Health: ${topCandidate.scoreBreakdown.health}]. Matches ${taskSpec.taskClass.replace('_', ' ')} under ${taskSpec.costPolicy.replace('_', ' ')} policy.`;

  const decisionTrace: DecisionTrace = {
    taskSpec,
    evaluatedRoutesCount: allRoutes.length,
    eligibleRoutesCount: eligible.length,
    candidates: [
      ...rejected.map((r) => r.traceItem),
      ...scored.map((s) => s.traceItem),
    ],
    selectedRouteId: topCandidate.route.id,
    selectionRationale,
    timestamp: new Date().toISOString(),
  };

  return {
    taskSpec,
    selectedRoute: topCandidate.route,
    selectedModel: topCandidate.model,
    selectedProvider: topCandidate.provider,
    decisionTrace,
    selectionRationale,
  };
}
