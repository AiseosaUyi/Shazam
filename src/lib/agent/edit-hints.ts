/** Help for a failed edit_file: show the nearest real lines instead of letting the model guess again. */

const MAX_HINT_CHARS = 1500;
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_$]+/g) || []);

/** Up to 3 lines of the file most like the first line of old_string, with 2 lines of context each. */
export function nearestLines(content: string, oldString: string): string {
  const none = 'No similar lines found. Call read_file and copy the exact current text.';
  const first = oldString.split('\n').find((l) => l.trim());
  if (!first) return none;
  const target = words(first);
  if (!target.size) return none;
  const lines = content.split('\n');
  const scored: Array<{ i: number; score: number }> = [];
  lines.forEach((line, i) => {
    const w = words(line);
    if (!w.size) return;
    let both = 0;
    for (const t of target) if (w.has(t)) both++;
    const score = both / (target.size + w.size - both);
    if (score >= 0.4) scored.push({ i, score });
  });
  if (!scored.length) return none;
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const blocks = scored.slice(0, 3).map(({ i }) => {
    const from = Math.max(0, i - 2);
    const to = Math.min(lines.length - 1, i + 2);
    const ctx = [];
    for (let n = from; n <= to; n++) ctx.push(`${n + 1}\t${lines[n]}`);
    return `line ${i + 1}: ${lines[i].trim().slice(0, 160)}\n${ctx.join('\n')}`;
  });
  const out = blocks.join('\n---\n');
  return out.length > MAX_HINT_CHARS ? `${out.slice(0, MAX_HINT_CHARS - 1)}…` : out;
}

/** Counts failed edits per file within a run. */
export class EditFailureTracker {
  private counts = new Map<string, number>();
  record(path: string): number {
    const n = (this.counts.get(path) || 0) + 1;
    this.counts.set(path, n);
    return n;
  }
  reset(path: string): void {
    this.counts.delete(path);
  }
}

export function failureAdvice(path: string, count: number, canReplaceLines: boolean): string {
  if (count < 2) return '';
  return `This is failed edit number ${count} on ${path}. Stop retrying edit_file with guessed text. ${canReplaceLines ? 'Use replace_lines(path, start, end, new_text) with line numbers from read_file, or write_file if the file is small.' : 'Use write_file for a small file, or read_file again and copy the exact text.'}`;
}

/** Strips the "N\t" line-number prefixes read_file adds. */
export const stripLineNumbers = (numbered: string): string => numbered.split('\n').map((l) => l.replace(/^\d+\t/, '')).join('\n');

/** Replaces lines start..end (1-based, inclusive) of content, or says why it cannot. */
export function replaceLineRange(content: string, start: number, end: number, newText: string): { ok: true; content: string; added: number; removed: number } | { ok: false; error: string } {
  const lines = content.split('\n');
  if (start > end || end > lines.length) return { ok: false, error: `Error: line range out of bounds (file has ${lines.length} lines).` };
  const insert = newText === '' ? [] : newText.split('\n');
  return { ok: true, content: [...lines.slice(0, start - 1), ...insert, ...lines.slice(end)].join('\n'), added: insert.length, removed: end - start + 1 };
}
