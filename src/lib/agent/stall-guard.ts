import { createHash } from 'node:crypto';

/** Steps with no edit before the model is told firmly to stop exploring. */
export const STALL_WARN_AT = 25;
/** Steps with no edit before the run ends as "stalled" instead of burning more budget. */
export const STALL_STOP_AT = 50;

/** The same command failing the same way this many times in a row: warn, then stop. */
export const REPEAT_WARN_AT = 3;
export const REPEAT_STOP_AT = 6;

const hash = (s: string) => createHash('sha1').update(s).digest('hex');

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i;
export const isTestPath = (p: string) => TEST_PATH.test(p);

/** What a failing command output "is", ignoring numbers, timings and paths, so the same failure matches itself. */
export function failureSignature(output: string): string {
  const key = output.split('\n').filter((l) => /fail|error|assert|expected|actual|not ok|✖|✗|cannot|undefined/i.test(l)).slice(0, 8);
  const body = (key.length ? key.join('\n') : output.slice(-300)).replace(/\/[\w./-]+/g, '<path>').replace(/\d+(\.\d+)?\s?(ms|s)\b/g, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return hash(body);
}

export interface StallGuardOptions {
  enabled?: boolean;
  /** Steps already spent with no edit in earlier segments of this run. */
  sinceEdit?: number;
  warnAt?: number;
  stopAt?: number;
}

/**
 * Watches a run for exploring without editing, and remembers what was read so the same
 * unchanged range is not sent to the model again. Pure state: tool_agent wires it to the tools.
 */
export class StallGuard {
  readonly enabled: boolean;
  readonly warnAt: number;
  readonly stopAt: number;
  sinceEdit: number;
  step = 0;
  private reads = new Map<string, { hash: string; step: number; count: number }>();
  private files = new Set<string>();
  private lastSig: string | null = null;
  /** How many times in a row the last command failed the same way. */
  repeatFailures = 0;

  constructor(o: StallGuardOptions = {}) {
    this.enabled = o.enabled ?? true;
    this.warnAt = o.warnAt ?? STALL_WARN_AT;
    this.stopAt = o.stopAt ?? STALL_STOP_AT;
    this.sinceEdit = o.sinceEdit ?? 0;
  }

  /** A tool call is starting. */
  begin(): void {
    this.step++;
    this.sinceEdit++;
  }

  /** A successful edit, write or delete happened. */
  onEdit(): void {
    this.sinceEdit = 0;
  }

  get stalled(): boolean {
    return this.enabled && (this.sinceEdit >= this.stopAt || this.repeatFailures >= REPEAT_STOP_AT);
  }

  /** Why the run is stalled, if it is. */
  get stallReason(): 'repeat_failure' | 'no_edit' | null {
    if (!this.stalled) return null;
    return this.repeatFailures >= REPEAT_STOP_AT ? 'repeat_failure' : 'no_edit';
  }

  /** A command finished. Counts consecutive identical failures (edits in between do not reset it). */
  onCommand(output: string): void {
    const code = Number(output.match(/exit code: (\d+)/)?.[1] ?? 0);
    if (code === 0) { this.lastSig = null; this.repeatFailures = 0; return; }
    const sig = failureSignature(output);
    this.repeatFailures = sig === this.lastSig ? this.repeatFailures + 1 : 1;
    this.lastSig = sig;
  }

  /** The note added to a failing command result once the same failure keeps coming back. */
  annotateCommand(result: string): string {
    if (!this.enabled || this.repeatFailures < REPEAT_WARN_AT) return result;
    return `${result}\n\nSAME FAILURE ${this.repeatFailures} TIMES IN A ROW: your last ${this.repeatFailures - 1} fixes did not change this result. Stop guessing. Re-read the failing assertion and the code it runs, say in one sentence what the test expects and what you got, then fix the cause. Do NOT change a test's expectations to match the output unless the brief says the test is wrong. If you are blocked, say exactly what blocks you and finish.`;
  }

  get filesRead(): string[] {
    return [...this.files];
  }

  /** For a repeat read of an unchanged range, a short note to send instead of the content. */
  checkRead(path: string, offset: number | undefined, limit: number | undefined, content: string): string | null {
    if (/^Error/.test(content)) return null;
    this.files.add(path);
    const key = `${path}:${offset ?? ''}:${limit ?? ''}`;
    const h = hash(content);
    const prev = this.reads.get(key);
    if (!prev || prev.hash !== h) {
      this.reads.set(key, { hash: h, step: this.step, count: 1 });
      return null;
    }
    prev.count++;
    if (!this.enabled) return null;
    const lines = content.match(/\((\d+) lines\)/)?.[1];
    const range = `lines ${offset || 1}-${lines ? Math.min(Number(lines), (offset || 1) + (limit || 400) - 1) : '…'}`;
    return `Already read ${range} of ${path} at step ${prev.step}; the file is unchanged (read ${prev.count} times). The content is earlier in this conversation: do not read it again. Use grep for specific lines if you need exact text, then make your edit.`;
  }

  /** Adds the firm instruction to a tool result once the run has gone too long without an edit. */
  annotate(result: string): string {
    if (!this.enabled || this.sinceEdit < this.warnAt) return result;
    const files = this.filesRead.slice(0, 12).join(', ') || '(none)';
    return `${result}\n\nSTOP EXPLORING: ${this.sinceEdit} steps with no edit. You have read enough. Make your first edit NOW with edit_file or write_file. Files already read: ${files}. If you cannot edit, say exactly what blocks you and finish.`;
  }
}
