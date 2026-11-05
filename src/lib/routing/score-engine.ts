import type { CatalogRoute, DecisionCandidate, Model, TaskSpec } from '@/lib/types';

export function scoreCandidates(
  candidates: DecisionCandidate[],
  taskSpec: TaskSpec,
  models: Map<string, Model>,
  routes: Map<string, CatalogRoute>,
  health: Map<string, { consecutiveErrors: number; ewmaLatencyMs: number | null }> = new Map()
): DecisionCandidate[] {
  const scored = candidates.map((cand) => {
    const model = models.get(cand.modelId)!;
    const route = routes.get(cand.routeId)!;

    // 1. Internal quality prior (1-5 normalized to 0.2 - 1.0)
    let priorScore = model.qualityTier / 5.0;
    if (model.strengths.includes(taskSpec.taskClass)) {
      priorScore = Math.min(1.0, priorScore + 0.1);
    }

    // 2. Cost score (0.0 - 1.0)
    let costScore = 1.0;
    if (route.costClass === 'paid' && route.pricing) {
      const avgTokenRate = (route.pricing.inputPer1M + route.pricing.outputPer1M) / 2;
      costScore = Math.min(1.0, Math.max(0.05, 1.0 / (1.0 + avgTokenRate / 2.0)));
    } else if (route.costClass === 'unknown') {
      costScore = 0.3;
    }

    // 3. Quota confidence score
    let quotaScore: number;
    if (route.quotaConfidence === 'observed') quotaScore = 1.0;
    else if (route.quotaConfidence === 'estimated') quotaScore = 0.7;
    else quotaScore = 0.3;

    // 4. Health: routes that keep failing sink, even after their cooldown ends (1, 0.5, 0.33, ...)
    const h = health.get(cand.routeId);
    const healthScore = 1 / (1 + (h?.consecutiveErrors ?? 0));

    // 5. Latency: observed EWMA, neutral when we have no data yet (1s ~0.8, 4s ~0.5, 12s ~0.25)
    const latencyScore = h?.ewmaLatencyMs != null ? 1 / (1 + h.ewmaLatencyMs / 4000) : 0.6;

    // Weights per cost policy (each set sums to 1)
    let wPrior = 0.40;
    let wCost = 0.30;
    let wQuota = 0.15;
    let wHealth = 0.10;
    let wLatency = 0.05;

    switch (taskSpec.costPolicy) {
      case 'free_only':
        wPrior = 0.60;
        wCost = 0.00;
        wQuota = 0.25;
        wHealth = 0.10;
        wLatency = 0.05;
        break;
      case 'lowest_cost':
        wPrior = 0.20;
        wCost = 0.60;
        wQuota = 0.10;
        wHealth = 0.07;
        wLatency = 0.03;
        break;
      case 'best_quality':
        wPrior = 0.72;
        wCost = 0.08;
        wQuota = 0.08;
        wHealth = 0.08;
        wLatency = 0.04;
        break;
      case 'manual_pin':
        wPrior = 0.55;
        wCost = 0.15;
        wQuota = 0.15;
        wHealth = 0.10;
        wLatency = 0.05;
        break;
    }

    const totalScore = Number(
      (
        wPrior * priorScore +
        wCost * costScore +
        wQuota * quotaScore +
        wHealth * healthScore +
        wLatency * latencyScore
      ).toFixed(4)
    );

    return {
      ...cand,
      score: totalScore,
      breakdown: {
        prior: Number((wPrior * priorScore).toFixed(4)),
        cost: Number((wCost * costScore).toFixed(4)),
        quota: Number((wQuota * quotaScore).toFixed(4)),
        health: Number((wHealth * healthScore).toFixed(4)),
        latency: Number((wLatency * latencyScore).toFixed(4)),
      },
    };
  });

  // Sort descending by score
  return scored.sort((a, b) => (b.score || 0) - (a.score || 0));
}
