/** Measured speed of a model from past runs, so a long task can warn about the time cap up front. */

interface PastRun {
  model: string | null;
  status: string;
  agent: string;
  events: Array<{ type: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}

/** Steps per minute over finished code runs on the model (null when there is too little data). */
export function stepsPerMinute(runs: PastRun[], model?: string | null): number | null {
  let steps = 0;
  let minutes = 0;
  for (const r of runs) {
    if (r.agent !== 'code' || !['done', 'partial', 'stalled', 'no_changes'].includes(r.status)) continue;
    if (model && !(r.model || '').toLowerCase().includes(model.toLowerCase())) continue;
    const n = r.events.filter((e) => e.type === 'step').length;
    const m = (Date.parse(r.updatedAt) - Date.parse(r.createdAt)) / 60_000;
    if (n >= 5 && m > 0.5) { steps += n; minutes += m; }
  }
  return minutes > 0 ? steps / minutes : null;
}

/** One line for the start of a task: the time cap, and a warning when the step budget will not fit. */
export function durationNote(o: { maxSteps: number; capMinutes: number; maxSegments: number; rate: number | null; model?: string | null }): string {
  const cap = `Time cap: ${o.maxSegments} segments (about ${o.capMinutes} min). If it is hit you get a partial result, not an error.`;
  if (!o.rate) return cap;
  const est = Math.round(o.maxSteps / o.rate);
  const speed = `${o.rate.toFixed(1)} steps/min${o.model ? ` on ${o.model}` : ''}`;
  return est > o.capMinutes * 0.8
    ? `${cap}\nWARNING: at the measured ${speed}, ${o.maxSteps} steps take about ${est} min, over the ${o.capMinutes} min cap. Split the work into smaller tasks or use a faster model.`
    : `${cap} Estimate: about ${est} min for ${o.maxSteps} steps (${speed}).`;
}

export interface ModelStats {
  model: string;
  runs: number;
  /** Share of finished code runs that actually made edits (status done). */
  editSuccess: number;
  stepsPerMin: number | null;
}

/** Per-model speed and edit success from past code runs. */
export function modelStats(runs: PastRun[]): ModelStats[] {
  const by = new Map<string, PastRun[]>();
  for (const r of runs) {
    if (r.agent !== 'code' || !r.model || !['done', 'partial', 'stalled', 'no_changes'].includes(r.status)) continue;
    const key = r.model.split(' · ')[0];
    by.set(key, [...(by.get(key) || []), r]);
  }
  return [...by.entries()].map(([model, rs]) => ({ model, runs: rs.length, editSuccess: rs.filter((r) => r.status === 'done').length / rs.length, stepsPerMin: stepsPerMinute(rs) }));
}

/**
 * After a stall, a better model to retry on, or null. Needs 3+ runs of evidence and a clear edge
 * (edit success 20+ points higher, or the same success and 1.5x faster). It only offers: switching is
 * left to the caller so a local-first preference is never overridden.
 */
export function suggestModel(stats: ModelStats[], current: string | null | undefined): string | null {
  const cur = current ? current.split(' · ')[0] : null;
  const mine = stats.find((s) => s.model === cur);
  const better = stats
    .filter((s) => s.model !== cur && s.runs >= 3)
    .filter((s) => !mine || s.editSuccess >= mine.editSuccess + 0.2 || (s.editSuccess >= mine.editSuccess && (s.stepsPerMin ?? 0) >= (mine.stepsPerMin ?? 0) * 1.5 && (mine.stepsPerMin ?? 0) > 0))
    .sort((a, b) => b.editSuccess - a.editSuccess || (b.stepsPerMin ?? 0) - (a.stepsPerMin ?? 0));
  const pick = better[0];
  if (!pick) return null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `Suggestion: retry on model "${pick.model}": it made edits in ${pct(pick.editSuccess)} of ${pick.runs} recent runs${pick.stepsPerMin ? ` at ${pick.stepsPerMin.toFixed(1)} steps/min` : ''}${mine ? `, against ${pct(mine.editSuccess)} for ${mine.model}` : ''}. Pass it as the model argument of start_task. (It is only a suggestion: nothing switched by itself.)`;
}
