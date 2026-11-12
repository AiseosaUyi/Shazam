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
