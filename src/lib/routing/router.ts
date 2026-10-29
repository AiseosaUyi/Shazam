import { DbRepo } from '@/lib/db/repo';
import { getLiveCatalog } from '@/lib/catalog';
import { envFlag, envVar } from '@/lib/env';
import { filterCandidates, FilterContext } from './candidate-filter';
import { scoreCandidates } from './score-engine';
import type {
  CatalogRoute,
  DecisionTrace,
  Model,
  Provider,
  ProviderError,
  Route,
  TaskSpec,
  User,
} from '@/lib/types';

export interface RouteResolution {
  taskSpec: TaskSpec;
  selectedRoute: CatalogRoute;
  selectedModel: Model;
  selectedProvider: Provider;
  decisionTrace: DecisionTrace;
  rationale: string;
}

export async function resolveTaskRoute(
  taskSpec: TaskSpec,
  user: User,
  repo = new DbRepo(),
  excludedRouteIds: string[] = []
): Promise<RouteResolution> {
  const catalog = await getLiveCatalog(repo);

  const modelMap = new Map(catalog.models.map((m) => [m.id, m]));
  const providerMap = new Map(catalog.providers.map((p) => [p.id, p]));
  const routeMap = new Map(catalog.routes.map((r) => [r.id, r]));

  // User credentials
  const credentials = await repo.getCredentials(user.id);
  const userValidCreds = new Set(
    credentials.filter((c) => c.status === 'valid').map((c) => c.providerId)
  );

  // System keys
  const systemKeys = new Set<string>();
  if (envVar('GOOGLE_AI_API_KEY')) systemKeys.add('google');
  if (envVar('OPENAI_API_KEY')) systemKeys.add('openai');
  if (envVar('ANTHROPIC_API_KEY')) systemKeys.add('anthropic');
  if (envVar('DEEPSEEK_API_KEY')) systemKeys.add('deepseek');
  if (envVar('OPENROUTER_API_KEY')) systemKeys.add('openrouter');

  const canUseSystemKeys = user.role === 'admin' || envFlag('SHAZAM_SHARE_SYSTEM_KEYS', false);

  // Cooldowns
  const activeCooldowns = new Map<string, string>();
  for (const r of catalog.routes) {
    const userHealth = await repo.getRouteHealth(r.id, user.id);
    if (userHealth?.cooldownUntil && new Date(userHealth.cooldownUntil).getTime() > Date.now()) {
      activeCooldowns.set(r.id, userHealth.cooldownUntil);
      continue;
    }
    const globalHealth = await repo.getRouteHealth(r.id, 'global');
    if (globalHealth?.cooldownUntil && new Date(globalHealth.cooldownUntil).getTime() > Date.now()) {
      activeCooldowns.set(r.id, globalHealth.cooldownUntil);
    }
  }

  // Filter out any explicitly excluded routes (e.g. from prior failed attempts)
  const candidateRoutes = catalog.routes.filter((r) => !excludedRouteIds.includes(r.id));

  const filterCtx: FilterContext = {
    taskSpec,
    models: modelMap,
    providers: providerMap,
    userCredentials: userValidCreds,
    systemKeysAvailable: systemKeys,
    canUseSystemKeys,
    activeCooldowns,
  };

  const { eligible, rejected } = filterCandidates(candidateRoutes, filterCtx);

  if (eligible.length === 0) {
    const reasons = rejected.map((r) => `${r.routeId}: ${r.rejection}`).join('; ');
    throw new Error(
      `No eligible routes found under policy "${taskSpec.costPolicy.replace('_', ' ')}". Details: ${reasons}`
    );
  }

  // Stage 2 Scoring
  const scored = scoreCandidates(eligible, taskSpec, modelMap, routeMap);
  const topCandidate = scored[0];

  const chosenRoute = routeMap.get(topCandidate.routeId)!;
  const chosenModel = modelMap.get(topCandidate.modelId)!;
  const chosenProvider = providerMap.get(topCandidate.providerId)!;

  const rationale = `Selected ${chosenModel.name} via ${chosenProvider.name} (${chosenRoute.costClass}). Prior score: ${topCandidate.breakdown?.prior ?? chosenModel.qualityTier}/5 under ${taskSpec.costPolicy.replace('_', ' ')} policy.`;

  const trace: DecisionTrace = {
    policyVersion: '2026-10-27.1',
    taskSpec,
    evaluated: catalog.routes.length,
    eligible: eligible.length,
    candidates: [...rejected, ...scored],
    selectedRouteId: topCandidate.routeId,
    rationale,
    createdAt: new Date().toISOString(),
  };

  return {
    taskSpec,
    selectedRoute: chosenRoute,
    selectedModel: chosenModel,
    selectedProvider: chosenProvider,
    decisionTrace: trace,
    rationale,
  };
}

export async function determineFallback(
  taskSpec: TaskSpec,
  failedRoute: CatalogRoute,
  error: ProviderError,
  user: User,
  repo: DbRepo,
  excludedRouteIds: string[]
): Promise<RouteResolution | null> {
  // 1. content_policy stops task with NO fallback
  if (error.type === 'content_policy') {
    return null;
  }

  // 2. A pinned route never switches or falls back to a different model
  if (taskSpec.pinnedRouteId) {
    return null;
  }
  let fallbackSpec: TaskSpec = taskSpec;

  // 3. Check retryable error type
  const isRetryableError =
    error.retryable ||
    error.type === 'quota_exhausted' ||
    error.type === 'invalid_credentials' ||
    error.type === 'rate_limited' ||
    error.type === 'model_unavailable' ||
    error.type === 'timeout';

  if (!isRetryableError) {
    return null;
  }

  // 4. Update cooldown in D1
  const userCred = await repo.getCredential(user.id, failedRoute.providerId);
  const scope = userCred ? user.id : 'global';
  const cooldownSecs = error.retryAfterSeconds ?? (error.type === 'rate_limited' ? 30 : 60);
  const cooldownUntil = new Date(Date.now() + cooldownSecs * 1000).toISOString();
  await repo.setRouteCooldown(failedRoute.id, scope, cooldownUntil, error.type);

  // If 401 invalid credentials on user key, mark invalid
  if (error.statusCode === 401 || error.type === 'invalid_credentials') {
    await repo.markCredentialStatus(user.id, failedRoute.providerId, 'invalid');
  }

  // 5. Cost Policy checks:
  // - Never fall back from free to paid
  // - Paid to paid only when allow_paid_fallback is enabled in user preferences
  const userPrefs = await repo.getUserPreferences(user.id);
  const mustStayFree =
    failedRoute.costClass === 'verified_free' ||
    failedRoute.costClass === 'user_allowance' ||
    !userPrefs.allowPaidFallback;
  fallbackSpec = mustStayFree ? { ...fallbackSpec, costPolicy: 'free_only' } : fallbackSpec;

  // 6. Attempt next resolution excluding failed route
  const nextExcluded = [...excludedRouteIds, failedRoute.id];
  try {
    return await resolveTaskRoute(fallbackSpec, user, repo, nextExcluded);
  } catch {
    return null;
  }
}
