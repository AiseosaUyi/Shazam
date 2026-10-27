import type { CatalogRoute, DecisionCandidate, Model, TaskSpec } from '@/lib/types';

export function scoreCandidates(
  candidates: DecisionCandidate[],
  taskSpec: TaskSpec,
  models: Map<string, Model>,
  routes: Map<string, CatalogRoute>
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
    let quotaScore = 0.5;
    if (route.quotaConfidence === 'observed') quotaScore = 1.0;
    else if (route.quotaConfidence === 'estimated') quotaScore = 0.7;
    else quotaScore = 0.3;

    // Weights per cost policy
    let wPrior = 0.45;
    let wCost = 0.35;
    let wQuota = 0.20;

    switch (taskSpec.costPolicy) {
      case 'free_only':
        wPrior = 0.70;
        wCost = 0.00;
        wQuota = 0.30;
        break;
      case 'lowest_cost':
        wPrior = 0.20;
        wCost = 0.65;
        wQuota = 0.15;
        break;
      case 'best_quality':
        wPrior = 0.80;
        wCost = 0.10;
        wQuota = 0.10;
        break;
      case 'manual_pin':
        wPrior = 0.60;
        wCost = 0.20;
        wQuota = 0.20;
        break;
    }

    const totalScore = Number(
      (wPrior * priorScore + wCost * costScore + wQuota * quotaScore).toFixed(4)
    );

    return {
      ...cand,
      score: totalScore,
      breakdown: {
        prior: Number((wPrior * priorScore).toFixed(4)),
        cost: Number((wCost * costScore).toFixed(4)),
        quota: Number((wQuota * quotaScore).toFixed(4)),
      },
    };
  });

  // Sort descending by score
  return scored.sort((a, b) => (b.score || 0) - (a.score || 0));
}
