/** Compact task summaries for MCP callers, so reviewing work costs them little usage. */

/** Still working: paused runs resume on their own after a time limit. */
export const ACTIVE = new Set(['queued', 'running', 'paused']);
/** Longest a status check waits on our side. Kept under common MCP client timeouts (~60s). */
export const MAX_WAIT_S = 45;
export const SUMMARY_RESULT_CHARS = 1500;

/**
 * Compact by default so the calling assistant spends little of its own usage reviewing:
 * the last few progress lines and a short result. detail="full" returns everything.
 */
export function summarizeRun(run: any, sinceEvent = 0, detail: 'summary' | 'full' = 'summary') {
  const full = detail === 'full';
  const all = run.events.slice(sinceEvent);
  const shown = all.slice(full ? -25 : -5).map((e: any, i: number, arr: any[]) => `${sinceEvent + all.length - arr.length + i}. [${e.type}] ${e.text}`);
  const result = String(run.result || '');
  const cut = !full && result.length > SUMMARY_RESULT_CHARS;
  return [
    `task_id: ${run.id}`,
    `agent: ${run.agent} · status: ${run.status}${run.model ? ` · model: ${run.model}` : ''}`,
    run.projectId ? `project_id: ${run.projectId}` : null,
    run.filesChanged?.length ? `files changed: ${run.filesChanged.join(', ')}` : null,
    shown.length ? `progress${all.length > shown.length ? ` (last ${shown.length} of ${all.length} new)` : ''} (next since_event=${run.events.length}):\n${shown.join('\n')}` : null,
    run.status === 'done' || run.status === 'no_changes' || run.status === 'stalled' ? `\nRESULT:\n${cut ? `${result.slice(0, SUMMARY_RESULT_CHARS)}…\n[Shortened. Call get_task_status with detail="full" only if you need the rest.]` : result.slice(0, 8000)}` : null,
    run.status === 'error' ? `\nERROR: ${run.error}` : null,
    ACTIVE.has(run.status) ? '\nStill working. Call get_task_status again right away (it waits for news on our side).' : null,
  ].filter(Boolean).join('\n');
}

