import type { ModelMessage } from 'ai';

/**
 * Keeps long agent runs fast. Every step resends the whole conversation, so after dozens of
 * file reads a step costs minutes on a local model and burns free-tier token budgets. Once the
 * conversation is large, older tool output, big file writes and old reasoning are shortened;
 * the most recent steps stay intact. The agent can always re-read a file it needs.
 */

export interface CompactOptions {
  /** Start compacting above this many characters (~4 chars per token). */
  maxChars?: number;
  /** Tool results kept in full, counting back from the newest. */
  keepRecentResults?: number;
  /** Characters kept from each older tool result. */
  keepHead?: number;
  /** Total characters of recent tool results kept in full (~10K tokens); the newest is always kept. */
  keepRecentChars?: number;
}

const MARK = '…[older output shortened to keep the run fast; read it again if you need it]';
const INPUT_MARK = '…[shortened]';

const size = (messages: ModelMessage[]) => JSON.stringify(messages).length;

function shortenText(text: string, head: number): string {
  if (text.length <= head + MARK.length || text.endsWith(MARK)) return text;
  return `${text.slice(0, head)}\n${MARK}`;
}

function shortenOutput(output: any, head: number): any {
  if (!output || typeof output !== 'object') return output;
  if (output.type === 'text' || output.type === 'error-text') return { ...output, value: shortenText(String(output.value ?? ''), head) };
  if (output.type === 'json' || output.type === 'error-json') {
    const json = JSON.stringify(output.value);
    return json.length > head + MARK.length ? { type: 'text', value: shortenText(json, head) } : output;
  }
  return output;
}

/** Shortens long string fields of an old tool call's input (e.g. the content of a file write). */
function shortenInput(input: any, limit = 400): any {
  if (!input || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === 'string' && v.length > limit + INPUT_MARK.length ? `${v.slice(0, limit)}${INPUT_MARK}` : v;
  return out;
}

export function compactMessages(messages: ModelMessage[], opts: CompactOptions = {}): ModelMessage[] {
  const maxChars = opts.maxChars ?? 60_000;
  const keepRecent = opts.keepRecentResults ?? 6;
  const head = opts.keepHead ?? 500;
  if (size(messages) <= maxChars) return messages;

  const keepChars = opts.keepRecentChars ?? 40_000;
  // Index of the oldest message that stays intact: recent tool results are kept in full until
  // either the count or the size budget is reached (a few big file reads can fill a context).
  let seen = 0;
  let kept = 0;
  let cutoff = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: any = messages[i];
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    const chars = JSON.stringify(m.content).length;
    if (seen > 0 && (seen >= keepRecent || kept + chars > keepChars)) break;
    seen += m.content.filter((p: any) => p.type === 'tool-result').length;
    kept += chars;
    cutoff = i;
  }
  // Everything before the oldest kept tool message is compacted.
  if (cutoff === messages.length) return messages;

  return messages.map((m: any, i) => {
    if (i >= cutoff || !Array.isArray(m.content)) return m;
    if (m.role === 'tool') {
      return { ...m, content: m.content.map((p: any) => (p.type === 'tool-result' ? { ...p, output: shortenOutput(p.output, head) } : p)) };
    }
    if (m.role === 'assistant') {
      const content = m.content
        .filter((p: any) => p.type !== 'reasoning' && p.type !== 'reasoning-file')
        .map((p: any) => (p.type === 'tool-call' ? { ...p, input: shortenInput(p.input) } : p));
      return { ...m, content: content.length ? content : [{ type: 'text', text: '' }] };
    }
    return m;
  });
}
