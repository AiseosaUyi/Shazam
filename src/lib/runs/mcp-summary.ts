/** Compact task summaries for MCP callers, so reviewing work costs them little usage. */

/** Still working: paused runs resume on their own after a time limit. */
export const ACTIVE = new Set(['queued', 'running', 'paused']);
/** Longest a status check waits on our side. Kept under common MCP client timeouts (~60s). */
export const MAX_WAIT_S = 45;
/** The most a caller may ask a single status check to wait (fewer polls on long tasks). */
export const MAX_WAIT_LONG_S = 300;
/** Statuses whose result text is shown. */
const TERMINAL_WITH_RESULT = new Set(['done', 'no_changes', 'stalled', 'partial']);
export const SUMMARY_RESULT_CHARS = 1500;

/** One short line per event: a step is its tool and main argument, a result is its first line. */
export function compactEvent(e: { type: string; text: string }): string {
  const text = String(e.text || '');
  if (e.type === 'step') {
    const m = text.match(/^(\S+)\s*(\{.*)?$/s);
    if (m?.[2]) {
      try {
        const a = JSON.parse(m[2]);
        const key = a.path ?? a.command ?? a.pattern ?? a.prefix ?? a.query ?? a.description ?? '';
        return `${m[1]} ${String(key).replace(/\s+/g, ' ').slice(0, 90)}`.trim();
      } catch {
        // Event text is cut at 200 chars, so the JSON may be incomplete: show the tool and start of the args.
        const path = m[2].match(/"(?:path|command|pattern)"\s*:\s*"([^"]{0,90})/)?.[1];
        return `${m[1]} ${path ?? ''}`.trim();
      }
    }
    return text.slice(0, 120);
  }
  const first = text.split('\n').find((l) => l.trim()) || '';
  return first.slice(0, e.type === 'plan' ? 160 : 110);
}

/** Facts for a run that is still going, read from its events (the final report is saved at the end). */
export function liveFacts(events: Array<{ type: string; text: string }>) {
  const files = [...new Set(events.filter((e) => e.type === 'file').map((e) => e.text))];
  const lastFile = events.map((e) => e.type).lastIndexOf('file');
  const stepsSinceLastEdit = events.slice(lastFile + 1).filter((e) => e.type === 'step').length;
  let tests: 'not_run' | 'passed' | 'failed' = 'not_run';
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 'step' && /\b(npm|pnpm|yarn)\s+(run\s+)?test|--test|\b(vitest|jest|pytest)\b/.test(events[i].text)) {
      const exit = events.slice(i + 1, i + 3).map((e) => e.text.match(/exit code: (\d+)/)?.[1]).find(Boolean);
      if (exit !== undefined) tests = exit === '0' ? 'passed' : 'failed';
    }
  }
  return { files: files.map((path) => ({ path, added: undefined as number | undefined, removed: undefined as number | undefined })), editsCount: events.filter((e) => e.type === 'file').length, stepsSinceLastEdit, testsStatus: tests };
}

/**
 * Compact by default so the calling assistant spends little of its own usage reviewing:
 * the last few one-line progress items and a short result, never file contents. Facts come from the
 * recorded report, or from events while the run is live. detail="full" returns everything.
 */
export function summarizeRun(run: any, sinceEvent = 0, detail: 'summary' | 'full' = 'summary') {
  const full = detail === 'full';
  const all = run.events.slice(sinceEvent);
  const shown = all.slice(full ? -25 : -5).map((e: any, i: number, arr: any[]) => `${sinceEvent + all.length - arr.length + i}. [${e.type}] ${full ? e.text : compactEvent(e)}`);
  const result = String(run.result || '');
  const cut = !full && result.length > SUMMARY_RESULT_CHARS;
  const report = run.options?.report;
  const live = liveFacts(run.events);
  const files: Array<{ path: string; added?: number; removed?: number }> = report?.filesChanged ?? live.files;
  const filesText = files.map((f) => (f.added === undefined ? f.path : `${f.path} (+${f.added}/-${f.removed})`)).join(', ') || (run.filesChanged?.length ? run.filesChanged.join(', ') : '');
  const code = run.agent === 'code';
  return [
    `task_id: ${run.id}`,
    `agent: ${run.agent} · status: ${run.status}${run.model ? ` · model: ${run.model}` : ''}`,
    run.projectId ? `project_id: ${run.projectId}` : null,
    code ? `files changed: ${filesText || 'none'}` : run.filesChanged?.length ? `files changed: ${run.filesChanged.join(', ')}` : null,
    code ? `edits_count: ${report?.editsCount ?? live.editsCount} · tests_status: ${report?.testsStatus ?? live.testsStatus} · steps_since_last_edit: ${run.options?.stepsSinceEdit ?? live.stepsSinceLastEdit} · segments_used: ${report?.segmentsUsed ?? (run.segment ?? 0) + 1}` : null,
    report?.warnings?.length ? `warnings: ${report.warnings.join(' | ')}` : null,
    shown.length ? `progress${all.length > shown.length ? ` (last ${shown.length} of ${all.length} new)` : ''} (next since_event=${run.events.length}):\n${shown.join('\n')}` : null,
    TERMINAL_WITH_RESULT.has(run.status) ? `\nRESULT:\n${cut ? `${result.slice(0, SUMMARY_RESULT_CHARS)}…\n[Shortened. Call get_task_status with detail="full" only if you need the rest.]` : result.slice(0, 8000)}` : null,
    run.status === 'error' ? `\nERROR: ${run.error}` : null,
  ].filter(Boolean).join('\n');
}
