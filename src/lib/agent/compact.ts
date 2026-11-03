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
  const maxChars = opts.maxChars ?? 80_000;
  const keepRecent = opts.keepRecentResults ?? 6;
  const head = opts.keepHead ?? 500;
  if (size(messages) <= maxChars) return messages;

  // Index of the oldest message that stays intact: the one holding the Nth-newest tool result.
  let seen = 0;
  let cutoff = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: any = messages[i];
    if (m.role === 'tool' && Array.isArray(m.content)) {
      seen += m.content.filter((p: any) => p.type === 'tool-result').length;
      if (seen >= keepRecent) {
        cutoff = i;
        break;
      }
    }
  }
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
