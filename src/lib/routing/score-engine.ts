import { CostPolicy, TaskClass, TaskSpec } from '@/types/core';
import { CandidateEvaluationResult } from './candidate-filter';
import { RouteTelemetry } from '@/types/core';

interface ScoringWeights {
  quality: number;
  health: number;
  latency: number;
  cost: number;
  quotaConfidence: number;
  privacy: number;
}

export function getPolicyWeights(costPolicy: CostPolicy, taskClass: TaskClass): ScoringWeights {
  switch (costPolicy) {
    case 'lowest_cost':
      return { quality: 0.20, health: 0.15, latency: 0.10, cost: 0.50, quotaConfidence: 0.03, privacy: 0.02 };
    case 'best_quality':
      return { quality: 0.65, health: 0.15, latency: 0.10, cost: 0.05, quotaConfidence: 0.03, privacy: 0.02 };
    case 'free_only':
      // Cost is already guaranteed $0 by hard filter; prioritize quality, health, quota confidence
      return { quality: 0.50, health: 0.25, latency: 0.15, cost: 0.00, quotaConfidence: 0.07, privacy: 0.03 };
    case 'manual_pin':
      return { quality: 0.50, health: 0.20, latency: 0.10, cost: 0.10, quotaConfidence: 0.05, privacy: 0.05 };
    case 'balanced':
    default:
      // Balanced policy weights
      return { quality: 0.40, health: 0.20, latency: 0.10, cost: 0.20, quotaConfidence: 0.05, privacy: 0.05 };
  }
}

export interface ScoredCandidate extends CandidateEvaluationResult {
  score: number;
  scoreBreakdown: {
    quality: number;
    health: number;
    latency: number;
    cost: number;
    quotaConfidence: number;
    privacy: number;
  };
}

export function scoreCandidates(
  candidates: CandidateEvaluationResult[],
  taskSpec: TaskSpec,
  telemetryMap: Map<string, RouteTelemetry>
): ScoredCandidate[] {
  const weights = getPolicyWeights(taskSpec.costPolicy, taskSpec.taskClass);

  const scored: ScoredCandidate[] = candidates.map((cand) => {
    const { model, route } = cand;
    const telem = telemetryMap.get(route.id);

    // 1. Quality score (0 - 100 normalized to 0.0 - 1.0)
    const taskQualityRaw = (model.qualityScores as any)?.[taskSpec.taskClass] ?? 85;
    const qualityScore = Math.min(1.0, Math.max(0.0, taskQualityRaw / 100));

    // 2. Health score (0.0 - 1.0)
    const errorRate = telem?.errorRateWindow ?? 0;
    const healthScore = Math.max(0.0, 1.0 - errorRate);

    // 3. Latency score (faster = higher score, e.g. 500ms -> 0.95, 3000ms -> 0.50)
    const p50 = telem?.p50LatencyMs ?? 1000;
    const latencyScore = Math.min(1.0, Math.max(0.1, 1.0 - p50 / 6000));

    // 4. Cost score (0.0 - 1.0)
    // 0 cost = 1.0; $10/M = 0.5; $30+/M = 0.1
    let costScore = 1.0;
    if (route.costClass === 'paid') {
      const avgTokenRate = (route.pricing.inputPer1MTokensUSD + route.pricing.outputPer1MTokensUSD) / 2;
      costScore = Math.min(1.0, Math.max(0.05, 1.0 / (1.0 + avgTokenRate / 2.0)));
    }

    // 5. Quota confidence score
    let quotaScore = 0.5;
    if (route.quotaConfidence === 'observed') quotaScore = 1.0;
    else if (route.quotaConfidence === 'estimated') quotaScore = 0.7;
    else quotaScore = 0.3;

    // 6. Privacy score
    let privacyScore = 0.8;
    if (!route.privacyPolicy.allowsModelTraining && route.privacyPolicy.dataRetentionDays === 0) {
      privacyScore = 1.0;
    } else if (route.privacyPolicy.allowsModelTraining) {
      privacyScore = 0.4;
    }

    // Weighted composite
    const compositeScore =
      weights.quality * qualityScore +
      weights.health * healthScore +
      weights.latency * latencyScore +
      weights.cost * costScore +
      weights.quotaConfidence * quotaScore +
      weights.privacy * privacyScore;

    const finalScore = Number(compositeScore.toFixed(4));

    cand.traceItem.score = finalScore;
    cand.traceItem.scoreBreakdown = {
      quality: Number((weights.quality * qualityScore).toFixed(4)),
      health: Number((weights.health * healthScore).toFixed(4)),
      latency: Number((weights.latency * latencyScore).toFixed(4)),
      cost: Number((weights.cost * costScore).toFixed(4)),
      quotaConfidence: Number((weights.quotaConfidence * quotaScore).toFixed(4)),
      privacy: Number((weights.privacy * privacyScore).toFixed(4)),
    };

    return {
      ...cand,
      score: finalScore,
      scoreBreakdown: cand.traceItem.scoreBreakdown,
    };
  });

  // Sort descending by score
  return scored.sort((a, b) => b.score - a.score);
}
