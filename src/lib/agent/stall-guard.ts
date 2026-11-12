import { createHash } from 'node:crypto';

/** Steps with no edit before the model is told firmly to stop exploring. */
export const STALL_WARN_AT = 25;
/** Steps with no edit before the run ends as "stalled" instead of burning more budget. */
export const STALL_STOP_AT = 50;

const hash = (s: string) => createHash('sha1').update(s).digest('hex');

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
    return this.enabled && this.sinceEdit >= this.stopAt;
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
