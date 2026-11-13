/**
 * Multi-fix briefs. A brief with 3+ labelled independent fixes (FIX 1/2/3, 1) 2) 3)) or 6+ named
 * files is run as sequential sub-tasks, each with its own step budget, so one weak model is never
 * asked to hold the whole list at once.
 */

export interface FixItem {
  label: string;
  /** The text of this fix (a labelled section, or the whole brief for a file group). */
  body: string;
  /** Files named in this fix, to read first. */
  files: string[];
}

export interface BriefPlan {
  preamble: string;
  postamble: string;
  items: FixItem[];
  kind: 'labelled' | 'files';
}

export interface FixResult {
  label: string;
  status: 'done' | 'stalled' | 'no_edits';
  summary: string;
  steps: number;
  files: string[];
}

/** Continuation state kept across resumed time segments. */
export interface SubtaskState {
  total: number;
  preamble: string;
  postamble: string;
  /** Fixes not started yet. */
  pending: FixItem[];
  done: FixResult[];
  /** The fix whose conversation is being resumed. */
  current?: FixItem;
  kind: 'labelled' | 'files';
}

export const MIN_FIXES = 3;
export const MIN_FILES = 6;
export const FILES_PER_GROUP = 3;

// Word labels (FIX 1:, TASK 2.) say "independent part". A bare "1." / "1)" is ambiguous (it is also how specs and rules are numbered), so it only counts when each item names its own file. STEP is excluded: steps depend on each other.
const LABEL = /^[ \t]*(?:(?:FIX|Fix|TASK|Task|PART|Part|ITEM|Item|P\d)[ \t]*[#-]?[ \t]*(\d+)[ \t]*[:.)\]-]|(\d+)[.)][ \t]+)/;
const TAIL = /^[ \t]*(?:#+[ \t]*)?(?:ACCEPTANCE|CONSTRAINTS|RULES|CHECKS|VERIFY|VERIFICATION|NOTES?|DONE WHEN)\b/i;
const FILE_RX = /(?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|css|scss|html|py|go|rs|sql|ya?ml|sh)\b/g;

export function filesIn(text: string): string[] {
  return [...new Set((text.match(FILE_RX) || []).filter((f) => !/^\d+\.\d+/.test(f) && !/^(e\.g|i\.e)\./i.test(f)))];
}

/** For bare numbered lists: every item must name at least one file that no other item names. */
function eachNamesOwnFile(lines: string[], run: Array<{ at: number }>): boolean {
  const per = run.map((m, k) => new Set(filesIn(lines.slice(m.at, k + 1 < run.length ? run[k + 1].at : lines.length).join('\n'))));
  return per.every((files, k) => [...files].some((f) => per.every((other, j) => j === k || !other.has(f))));
}

/** Splits a brief into sequential sub-tasks, or returns null when it is small enough to run as one. */
export function splitBrief(prompt: string): BriefPlan | null {
  const lines = prompt.split('\n');
  const marks: Array<{ at: number; n: number; bare: boolean }> = [];
  lines.forEach((l, i) => {
    const m = l.match(LABEL);
    if (m) marks.push({ at: i, n: Number(m[1] ?? m[2]), bare: m[1] === undefined });
  });
  // Keep an ascending run of labels (1, 2, 3 …); anything else in the text is not a fix list.
  const run: typeof marks = [];
  for (const m of marks) {
    if (!run.length ? m.n === 1 : m.n === run[run.length - 1].n + 1) run.push(m);
  }
  if (run.length >= MIN_FIXES && (!run.every((m) => m.bare) || eachNamesOwnFile(lines, run))) {
    let end = lines.length;
    let postamble = '';
    for (let i = run[run.length - 1].at + 1; i < lines.length; i++) {
      if (TAIL.test(lines[i])) { end = i; postamble = lines.slice(i).join('\n').trim(); break; }
    }
    const items: FixItem[] = run.map((m, k) => {
      const stop = k + 1 < run.length ? run[k + 1].at : end;
      const body = lines.slice(m.at, stop).join('\n').trim();
      return { label: `FIX ${m.n}`, body, files: filesIn(body) };
    });
    return { preamble: lines.slice(0, run[0].at).join('\n').trim(), postamble, items, kind: 'labelled' };
  }
  const files = filesIn(prompt);
  if (files.length >= MIN_FILES) {
    const items: FixItem[] = [];
    for (let i = 0; i < files.length; i += FILES_PER_GROUP) {
      const group = files.slice(i, i + FILES_PER_GROUP);
      items.push({ label: `FILES ${items.length + 1}`, body: `Only handle these files in this pass: ${group.join(', ')}. Other files are handled in other passes.`, files: group });
    }
    return { preamble: prompt.trim(), postamble: '', items, kind: 'files' };
  }
  return null;
}

/** The prompt for one sub-task: shared context, this fix only, and the files to read first. */
export function composeFixPrompt(plan: Pick<SubtaskState, 'preamble' | 'postamble' | 'total' | 'kind'>, item: FixItem, index: number): string {
  const read = item.files.length ? `\nFirst read these files, then make your first edit: ${item.files.join(', ')}.` : '';
  return [
    plan.preamble,
    plan.kind === 'labelled' ? `This brief has ${plan.total} independent parts. You are doing part ${index + 1} of ${plan.total} ONLY (${item.label}); the others run separately. Do not touch files that belong to other parts.` : `This brief is done in ${plan.total} passes. This is pass ${index + 1}.`,
    item.body,
    read.trim(),
    plan.postamble,
    'When done, reply with one short line: what you changed and whether it was verified.',
  ].filter(Boolean).join('\n\n');
}

/** One line per fix, built from recorded results (files come from tool events, not model prose). */
export function formatFixResults(done: FixResult[]): string {
  return done.map((r) => `${r.label}: ${r.status === 'done' ? 'done' : r.status === 'stalled' ? 'STALLED (no edit made)' : 'NO EDITS'} (${r.steps} steps; files: ${r.files.join(', ') || 'none'}) ${r.summary}`.trim()).join('\n');
}
