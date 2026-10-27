import { DecisionTraceItem, RouteTelemetry, TaskSpec } from '@/types/core';
import { Model, Provider, ProviderCredential, Route } from '@/types/provider';

export interface FilterContext {
  taskSpec: TaskSpec;
  models: Map<string, Model>;
  providers: Map<string, Provider>;
  telemetry: Map<string, RouteTelemetry>;
  userCredentials: Map<string, ProviderCredential>;
  systemKeysAvailable: Record<string, boolean>;
}

export interface CandidateEvaluationResult {
  route: Route;
  model: Model;
  provider: Provider;
  eligible: boolean;
  rejectionReason?: string;
  traceItem: DecisionTraceItem;
}

/**
 * Stage 1 Hard Eligibility Filter
 * Binary filters that reject incompatible or policy-violating routes.
 */
export function filterCandidates(
  routes: Route[],
  context: FilterContext
): { eligible: CandidateEvaluationResult[]; rejected: CandidateEvaluationResult[] } {
  const { taskSpec, models, providers, telemetry, userCredentials, systemKeysAvailable } = context;

  const eligible: CandidateEvaluationResult[] = [];
  const rejected: CandidateEvaluationResult[] = [];

  for (const route of routes) {
    const model = models.get(route.modelId);
    const provider = providers.get(route.providerId);

    // Initial item trace
    const traceItem: DecisionTraceItem = {
      routeId: route.id,
      modelId: route.modelId,
      providerId: route.providerId,
      status: 'filtered_out',
    };

    if (!model) {
      traceItem.filterRejectionReason = 'Associated model not found in catalogue.';
      rejected.push({ route, model: {} as any, provider: provider as any, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    if (!provider) {
      traceItem.filterRejectionReason = 'Associated provider not found in registry.';
      rejected.push({ route, model, provider: {} as any, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 1. Check Route and Provider administrative status
    if (route.status === 'disabled' || provider.status === 'disabled') {
      traceItem.filterRejectionReason = 'Route or provider is administratively disabled.';
      rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 2. Check Pinned Route constraint
    if (taskSpec.pinnedRouteId && taskSpec.pinnedRouteId !== route.id) {
      traceItem.filterRejectionReason = `Manual pin active on route: ${taskSpec.pinnedRouteId}.`;
      rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 3. Provider allow/disallow lists
    if (taskSpec.allowedProviders && taskSpec.allowedProviders.length > 0) {
      if (!taskSpec.allowedProviders.includes(route.providerId)) {
        traceItem.filterRejectionReason = `Provider ${provider.name} not in user allowed list.`;
        rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
        continue;
      }
    }
    if (taskSpec.disallowedProviders && taskSpec.disallowedProviders.includes(route.providerId)) {
      traceItem.filterRejectionReason = `Provider ${provider.name} is in user disallowed list.`;
      rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 4. Modality matching
    const missingInputModalities = taskSpec.inputModalities.filter(
      (m) => m !== 'text' && !model.modalities.includes(m)
    );
    if (missingInputModalities.length > 0) {
      traceItem.filterRejectionReason = `Model lacks input modality support for: ${missingInputModalities.join(', ')}.`;
      rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 5. Context window limit
    if (model.contextWindowTokens < taskSpec.contextEstimateTokens) {
      traceItem.filterRejectionReason = `Context window (${model.contextWindowTokens} tokens) smaller than estimated request size (${taskSpec.contextEstimateTokens} tokens).`;
      rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 6. Required capabilities (tools, reasoning)
    if (taskSpec.requiresTools && !model.supportsTools) {
      traceItem.filterRejectionReason = 'Task requires function/tool calling, which model does not support.';
      rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
      continue;
    }

    // 7. STRICT COST POLICY ENFORCEMENT
    if (taskSpec.costPolicy === 'free_only') {
      if (route.costClass !== 'verified_free' && route.costClass !== 'user_allowance') {
        traceItem.filterRejectionReason = `Free-Only policy violation: route cost class is "${route.costClass}". Paid or unknown routes are strictly prohibited.`;
        rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
        continue;
      }
    }

    // 8. Budget ceiling enforcement (if maxCostUSD is set and route is paid)
    if (route.costClass === 'paid' && taskSpec.maxCostUSD !== undefined) {
      const estimatedCost = (taskSpec.contextEstimateTokens * route.pricing.inputPer1MTokensUSD) / 1_000_000;
      if (estimatedCost > taskSpec.maxCostUSD) {
        traceItem.filterRejectionReason = `Estimated cost ($${estimatedCost.toFixed(4)}) exceeds user maximum per-task ceiling ($${taskSpec.maxCostUSD.toFixed(4)}).`;
        rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
        continue;
      }
    }

    // 9. Health & Cooldown checks
    const routeTelem = telemetry.get(route.id);
    if (routeTelem?.cooldownUntil) {
      const cooldownEnd = new Date(routeTelem.cooldownUntil).getTime();
      if (Date.now() < cooldownEnd) {
        traceItem.filterRejectionReason = `Route is in active rate-limit cooldown until ${new Date(cooldownEnd).toLocaleTimeString()}.`;
        rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
        continue;
      }
    }

    // 10. Credentials availability check
    if (route.accessMode === 'byok' || provider.requiresApiKey) {
      const hasUserKey = userCredentials.has(`${route.providerId}`);
      const hasSystemKey = systemKeysAvailable[route.providerId] === true;
      if (!hasUserKey && !hasSystemKey && route.providerId !== 'simulation') {
        traceItem.filterRejectionReason = `No valid API key connected for provider "${provider.name}".`;
        rejected.push({ route, model, provider, eligible: false, rejectionReason: traceItem.filterRejectionReason, traceItem });
        continue;
      }
    }

    // Candidate passed all hard filters!
    traceItem.status = 'eligible';
    eligible.push({ route, model, provider, eligible: true, traceItem });
  }

  return { eligible, rejected };
}
