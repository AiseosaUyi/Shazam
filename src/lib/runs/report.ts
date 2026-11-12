/**
 * Truthful run results. Everything here is computed from recorded tool events and git state,
 * never from the model's own prose. The model's summary is only kept after claims it cannot
 * back with events (commit hashes, changed files) are removed.
 */

export interface EditRecord {
  path: string;
  action: 'edit' | 'write' | 'delete';
  added: number;
  removed: number;
}

export interface CommandRecord {
  command: string;
  exitCode: number;
  /** Short hash parsed from the output of a successful `git commit` run by this agent. */
  commit?: string;
}

/** Git state of the user's working tree at one moment. */
export interface GitState {
  head: string | null;
  /** `git status --porcelain` entries: path → two-letter status. */
  dirty: Record<string, string>;
}

/** What a run has recorded so far, kept across resumed segments. */
export interface RunRecord {
  edits: EditRecord[];
  commands: CommandRecord[];
  /** Files someone else changed between this run reading and editing them. */
  external?: string[];
}

export type TestsStatus = 'not_run' | 'passed' | 'failed';
export type FinalStatus = 'done' | 'no_changes';

export interface RunReport {
  filesChanged: Array<{ path: string; added: number; removed: number }>;
  editsCount: number;
  commandsRun: CommandRecord[];
  commitsMadeByThisRun: string[];
  testsStatus: TestsStatus;
  warnings: string[];
  externalChanges: string[];
  status: FinalStatus;
  /** Time segments this run has used (each is about 7.5 minutes). */
  segmentsUsed: number;
}

export const emptyRecord = (): RunRecord => ({ edits: [], commands: [] });

export function mergeRecords(a: RunRecord | undefined | null, b: Partial<RunRecord> | undefined | null): RunRecord {
  return { edits: [...(a?.edits || []), ...(b?.edits || [])], commands: [...(a?.commands || []), ...(b?.commands || [])], external: [...new Set([...(a?.external || []), ...(b?.external || [])])] };
}

/** Lines in a piece of text (an empty string has none). */
export function countLines(s: string): number {
  return s === '' ? 0 : s.split('\n').length;
}

export function isTestCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnode\b[^|;&]*--test\b|\b(vitest|jest|pytest|mocha|go test|cargo test)\b/i.test(command);
}

export function testsStatus(commands: CommandRecord[]): TestsStatus {
  const tests = commands.filter((c) => isTestCommand(c.command));
  if (!tests.length) return 'not_run';
  return tests[tests.length - 1].exitCode === 0 ? 'passed' : 'failed';
}

/** Short hash from `git commit` output such as "[main 7f26909] message". */
export function parseCommitHash(output: string): string | undefined {
  return output.match(/^\[[^\]\n]*?\s([0-9a-f]{7,40})\]/m)?.[1];
}

export function parseHead(output: string): string | null {
  const body = output.replace(/^exit code: \d+\n?/, '').trim();
  return /^[0-9a-f]{40}$/.test(body) ? body : null;
}

/** Parses `git status --porcelain` output (with or without the "exit code:" header). */
export function parseGitStatus(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.replace(/^exit code: \d+\n?/, '').split('\n')) {
    if (line.length < 4 || line[2] !== ' ') continue;
    let path = line.slice(3).trim();
    if (path.includes(' -> ')) path = path.split(' -> ')[1];
    out[path.replace(/^"|"$/g, '')] = line.slice(0, 2);
  }
  return out;
}

const hashEq = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

/** Changes in the working tree that this run did not make. Never attributed to the run. */
export function detectExternalChanges(before: GitState | null | undefined, after: GitState | null | undefined, rec: RunRecord): string[] {
  if (!before || !after) return [];
  const warnings: string[] = [];
  const own = rec.commands.map((c) => c.commit).filter((h): h is string => Boolean(h));
  if (before.head && after.head && before.head !== after.head) {
    const ownCommit = own.some((h) => hashEq(after.head!, h));
    warnings.push(ownCommit
      ? `HEAD moved from ${before.head.slice(0, 7)} to ${after.head.slice(0, 7)}; the latest commit is this run's, but other commits may be in between.`
      : `HEAD moved from ${before.head.slice(0, 7)} to ${after.head.slice(0, 7)} during this run, and this run made no such commit. Someone else committed to the same working tree.`);
  }
  const edited = new Set(rec.edits.map((e) => e.path.replace(/^\.\//, '')));
  const foreign = Object.keys(after.dirty).filter((p) => !edited.has(p) && before.dirty[p] !== after.dirty[p]);
  if (foreign.length) {
    warnings.push(`Files changed that this run did not edit (the user, another process, or command side effects): ${foreign.slice(0, 20).join(', ')}${foreign.length > 20 ? ', …' : ''}.`);
  }
  return warnings;
}

const CHANGE_VERBS = /\b(fix|add|implement|change|update|edit|refactor|rename|create|write|remove|delete|replace|rewrite|move|extract|build|make|insert|patch|modify|convert|migrate|wire)\b/i;
const QUESTION_START = /^\s*(explain|what|why|how|where|which|who|summari[sz]e|review|describe|list|show|tell|find out|investigate|plan)\b/i;

/** Did the prompt ask for file changes? Questions and reviews do not. */
export function promptAsksForChanges(prompt: string): boolean {
  const p = prompt.replace(/^Reviewer feedback[^\n]*\n/, '');
  if (QUESTION_START.test(p) && !/\b(and|then)\s+(fix|change|update|edit|add|implement)\b/i.test(p)) return false;
  return CHANGE_VERBS.test(p);
}

/** Removes commit hashes this run did not create, and unverified files named in "changed" claims. */
export function sanitizeSummary(text: string, rec: RunRecord): string {
  const own = rec.commands.map((c) => c.commit).filter((h): h is string => Boolean(h));
  let out = text.replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi, (h) => (own.some((o) => hashEq(h.toLowerCase(), o.toLowerCase())) ? h : '[unverified hash removed]'));
  const changed = new Set(rec.edits.map((e) => e.path.replace(/^\.\//, '')));
  const pathRx = /(?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|json|md|css|scss|html|py|go|rs|sql|ya?ml|mjs|cjs)\b/g;
  out = out.split('\n').map((line) => {
    if (!/\b(changed|modified|edited|updated|created|added|fixed|wrote|written|rewrote|renamed|deleted|removed|touched)\b/i.test(line)) return line;
    return line.replace(pathRx, (p) => {
      const clean = p.replace(/^\.\//, '');
      return [...changed].some((c) => c === clean || c.endsWith(`/${clean}`) || clean.endsWith(`/${c}`)) ? p : '[unverified file]';
    });
  }).join('\n');
  return out;
}

export interface BuildReportInput {
  prompt: string;
  planMode?: boolean;
  record: RunRecord;
  gitBefore?: GitState | null;
  gitAfter?: GitState | null;
  segmentsUsed?: number;
}

export function buildReport(i: BuildReportInput): RunReport {
  const byPath = new Map<string, { path: string; added: number; removed: number }>();
  for (const e of i.record.edits) {
    const cur = byPath.get(e.path) || { path: e.path, added: 0, removed: 0 };
    cur.added += e.added;
    cur.removed += e.removed;
    byPath.set(e.path, cur);
  }
  const externalChanges = detectExternalChanges(i.gitBefore, i.gitAfter, i.record);
  if (i.record.external?.length) externalChanges.push(`Changed by someone else during the run (detected before an edit, so the edit was held back and redone on their version): ${i.record.external.join(', ')}.`);
  const commits = i.record.commands.map((c) => c.commit).filter((h): h is string => Boolean(h));
  const warnings = [...externalChanges.length ? ['external_changes_detected'] : [], ...externalChanges];
  const noEdits = i.record.edits.length === 0;
  const status: FinalStatus = !i.planMode && noEdits && promptAsksForChanges(i.prompt) ? 'no_changes' : 'done';
  return {
    filesChanged: [...byPath.values()],
    editsCount: i.record.edits.length,
    commandsRun: i.record.commands,
    commitsMadeByThisRun: commits,
    testsStatus: testsStatus(i.record.commands),
    warnings,
    externalChanges,
    status,
    segmentsUsed: i.segmentsUsed ?? 1,
  };
}

/** The result text the director reads: facts from events first, then the cleaned model summary. */
export function formatResult(report: RunReport, summary: string, rec: RunRecord): string {
  const parts: string[] = [];
  if (report.status === 'no_changes') parts.push('NO CHANGES MADE: this run recorded no successful edit or write, so nothing landed. The model summary below is unverified.');
  for (const w of report.warnings) parts.push(w === 'external_changes_detected' ? 'WARNING external_changes_detected: some changes in the working tree were not made by this run. Do not attribute them to it.' : `WARNING: ${w}`);
  const facts: string[] = [];
  facts.push(`Files changed by this run: ${report.filesChanged.length ? report.filesChanged.map((f) => `${f.path} (+${f.added}/-${f.removed})`).join(', ') : 'none'}`);
  facts.push(`Commits made by this run: ${report.commitsMadeByThisRun.length ? report.commitsMadeByThisRun.join(', ') : 'none'}`);
  facts.push(`Tests: ${report.testsStatus}`);
  if (report.commandsRun.length) facts.push(`Commands run: ${report.commandsRun.map((c) => `\`${c.command}\` → exit ${c.exitCode}`).join(', ')}`);
  return `${parts.length ? `${parts.join('\n')}\n\n` : ''}${sanitizeSummary(summary, rec)}\n\n${facts.join('\n')}`;
}

/** Todo items still not completed, from the last todo_write the run recorded. */
export function remainingTodos(events: Array<{ type: string; text: string }>): string[] {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== 'plan') continue;
    try {
      const todos = JSON.parse(events[i].text) as Array<{ content: string; status: string }>;
      return todos.filter((t) => t.status !== 'completed').map((t) => t.content);
    } catch {
      return [];
    }
  }
  return [];
}

/** The result of a run cut off by the time cap: what landed, what is left, and how to continue. */
export function formatPartial(report: RunReport, o: { segments: number; capMinutes: number; todos: string[]; diffStat?: string | null; reason?: string }): string {
  const head = o.reason || `PARTIAL: stopped at the time cap (${o.segments} segments, about ${o.capMinutes} min) before finishing. Nothing is lost: the work below is on disk. Send feedback to continue.`;
  const lines = [head, ''];
  lines.push(`Files changed so far: ${report.filesChanged.length ? report.filesChanged.map((f) => `${f.path} (+${f.added}/-${f.removed})`).join(', ') : 'none'}`);
  lines.push(`Remaining todo: ${o.todos.length ? o.todos.join('; ') : '(no todo list recorded)'}`);
  lines.push(`Tests: ${report.testsStatus}`);
  if (o.diffStat) lines.push(`Current git diff --stat:\n${o.diffStat.trim()}`);
  for (const w of report.warnings) if (w !== 'external_changes_detected') lines.push(`WARNING: ${w}`);
  return lines.join('\n');
}
