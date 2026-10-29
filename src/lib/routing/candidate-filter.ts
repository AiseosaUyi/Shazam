import type { CatalogRoute, DecisionCandidate, Model, Provider, TaskSpec } from '@/lib/types';

export interface FilterContext {
  taskSpec: TaskSpec;
  models: Map<string, Model>;
  providers: Map<string, Provider>;
  userCredentials: Set<string>; // set of providerIds user has connected
  systemKeysAvailable: Set<string>; // set of providerIds with system env keys
  canUseSystemKeys: boolean; // true if admin or SHAZAM_SHARE_SYSTEM_KEYS=true
  activeCooldowns: Map<string, string>; // routeId -> cooldownUntil ISO
}

export function filterCandidates(
  routes: CatalogRoute[],
  context: FilterContext
): { eligible: DecisionCandidate[]; rejected: DecisionCandidate[] } {
  const { taskSpec, models, providers, userCredentials, systemKeysAvailable, canUseSystemKeys, activeCooldowns } = context;

  const eligible: DecisionCandidate[] = [];
  const rejected: DecisionCandidate[] = [];

  for (const route of routes) {
    const model = models.get(route.modelId);
    const provider = providers.get(route.providerId);

    const cand: DecisionCandidate = {
      routeId: route.id,
      modelId: route.modelId,
      providerId: route.providerId,
      costClass: route.costClass,
      eligible: false,
    };

    if (!model) {
      cand.rejection = 'Associated model record not found in catalogue.';
      rejected.push(cand);
      continue;
    }

    if (!provider) {
      cand.rejection = 'Associated provider record not found in catalogue.';
      rejected.push(cand);
      continue;
    }

    // 1. Status check
    if (route.status === 'disabled' || provider.defaultStatus === 'disabled') {
      cand.rejection = route.statusReason || 'Route or provider is disabled.';
      rejected.push(cand);
      continue;
    }

    // 2. Pinned route / model check
    if (taskSpec.pinnedRouteId) {
      const pin = taskSpec.pinnedRouteId.toLowerCase();
      const matchesPin =
        route.id.toLowerCase() === pin ||
        route.modelId.toLowerCase() === pin ||
        model.id.toLowerCase() === pin ||
        model.providerModelId.toLowerCase() === pin ||
        model.name.toLowerCase() === pin ||
        (pin.includes('claude') && (model.id.includes('claude') || model.name.toLowerCase().includes('claude'))) ||
        (pin.includes('gpt') && (model.id.includes('gpt') || model.name.toLowerCase().includes('gpt'))) ||
        (pin.includes('gemini') && (model.id.includes('gemini') || model.name.toLowerCase().includes('gemini'))) ||
        (pin.includes('deepseek') && (model.id.includes('deepseek') || model.name.toLowerCase().includes('deepseek')));
      if (!matchesPin) {
        cand.rejection = `Manual pin active on: ${taskSpec.pinnedRouteId}.`;
        rejected.push(cand);
        continue;
      }
    }

    // 3. Provider allowlist
    if (taskSpec.allowedProviders && taskSpec.allowedProviders.length > 0) {
      if (!taskSpec.allowedProviders.includes(route.providerId)) {
        cand.rejection = `Provider "${provider.name}" is not in the allowed providers list.`;
        rejected.push(cand);
        continue;
      }
    }

    // 4. Modality matching
    const missingInputModalities = taskSpec.inputModalities.filter(
      (m) => m !== 'text' && !model.inputModalities.includes(m)
    );
    if (missingInputModalities.length > 0) {
      cand.rejection = `Model lacks input modality support for: ${missingInputModalities.join(', ')}.`;
      rejected.push(cand);
      continue;
    }

    if (model.outputModality !== taskSpec.outputModality) {
      cand.rejection = `Model output modality (${model.outputModality}) does not match task requirement (${taskSpec.outputModality}).`;
      rejected.push(cand);
      continue;
    }

    // 5. Capabilities check (tools, reasoning)
    if (taskSpec.requiredCapabilities.includes('tools') && !model.supportsTools) {
      cand.rejection = 'Task requires tool calling capability which this model lacks.';
      rejected.push(cand);
      continue;
    }
    if (taskSpec.requiredCapabilities.includes('reasoning') && !model.supportsReasoning) {
      cand.rejection = 'Task requires deep reasoning support which this model lacks.';
      rejected.push(cand);
      continue;
    }

    // 6. Context window check
    if (model.contextWindowTokens !== null && model.contextWindowTokens < taskSpec.contextEstimateTokens) {
      cand.rejection = `Context window (${model.contextWindowTokens}) is smaller than estimated request size (${taskSpec.contextEstimateTokens}).`;
      rejected.push(cand);
      continue;
    }

    // 7. Privacy Mode check
    if (taskSpec.privacyMode === 'strict') {
      if (route.privacy.providerMayTrainOnData === true || route.privacy.providerMayTrainOnData === 'unknown') {
        cand.rejection = 'Strict privacy mode excludes routes where data may be used for model training or training policy is unknown.';
        rejected.push(cand);
        continue;
      }
    }

    // 8. Cost Policy check
    if (taskSpec.costPolicy === 'free_only') {
      if (route.costClass !== 'verified_free' && route.costClass !== 'local_compute') {
        cand.rejection = `Free-Only policy strictly excludes ${route.costClass} routes.`;
        rejected.push(cand);
        continue;
      }
    }

    // Unknown-cost routes usable only when manually pinned
    if (route.costClass === 'unknown' && !taskSpec.pinnedRouteId) {
      cand.rejection = 'Routes with unknown cost can only be used via Manual Pin.';
      rejected.push(cand);
      continue;
    }

    // 9. Budget & Cap check
    let estimatedCostUSD: number | null = null;
    if (route.pricing) {
      const inputCost = (taskSpec.contextEstimateTokens * route.pricing.inputPer1M) / 1_000_000;
      const outputCost = (taskSpec.expectedOutputTokens * route.pricing.outputPer1M) / 1_000_000;
      estimatedCostUSD = Number((inputCost + outputCost).toFixed(6));
      cand.estimatedCostUSD = estimatedCostUSD;

      if (estimatedCostUSD > taskSpec.maxCostUSD) {
        cand.rejection = `Estimated cost ($${estimatedCostUSD.toFixed(4)}) exceeds per-task cap ($${taskSpec.maxCostUSD.toFixed(4)}).`;
        rejected.push(cand);
        continue;
      }

      if (estimatedCostUSD > taskSpec.monthlyBudgetRemainingUSD) {
        cand.rejection = `Estimated cost ($${estimatedCostUSD.toFixed(4)}) exceeds remaining monthly budget ($${taskSpec.monthlyBudgetRemainingUSD.toFixed(4)}).`;
        rejected.push(cand);
        continue;
      }
    }

    // 10. Cooldown check
    const cooldownUntil = activeCooldowns.get(route.id);
    if (cooldownUntil) {
      if (new Date(cooldownUntil).getTime() > Date.now()) {
        cand.rejection = `Route is in active rate-limit cooldown until ${new Date(cooldownUntil).toLocaleTimeString()}.`;
        rejected.push(cand);
        continue;
      }
    }

    // 11. Credentials check
    if (route.providerId !== 'simulation' && provider.requiresApiKey) {
      const hasUserKey = userCredentials.has(route.providerId);
      const hasSystemKey = canUseSystemKeys && systemKeysAvailable.has(route.providerId);
      if (!hasUserKey && !hasSystemKey) {
        cand.rejection = `No valid API key connected for provider "${provider.name}".`;
        rejected.push(cand);
        continue;
      }
    }

    // Candidate passed all hard filters!
    cand.eligible = true;
    eligible.push(cand);
  }

  return { eligible, rejected };
}
