import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream, tool } from 'ai';
import { z } from 'zod';
import { runToolAgent, MAX_SUBAGENTS, SUBAGENT_SUMMARY_CHARS } from '../src/lib/agent/tool_agent';
import { webSearch, webFetchText, parseDuckDuckGo, SEARCH_UNAVAILABLE, urlBlockReason } from '../src/lib/agent/web';

const usage: any = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function step(parts: any[], unified: 'tool-calls' | 'stop'): any {
  return { stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) };
}
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });
const toolNames = (c: any): string[] => (c.tools || []).map((t: any) => t.name);

const DDG_HTML = `
<div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1&amp;rut=abc">Example &amp; Docs</a></h2>
<a class="result__snippet" href="x">The <b>official</b> docs.</a></div>
<div class="result"><h2><a class="result__a" href="https://other.org/page">Other page</a></h2>
<a class="result__snippet" href="x">Second snippet</a></div>
<div class="result"><h2><a class="result__a" href="http://localhost:3000/admin">Local admin</a></h2>
<a class="result__snippet" href="x">should be dropped</a></div>`;

const okResponse = (body: string, json?: unknown): any => ({ ok: true, status: 200, headers: new Headers(), text: async () => body, json: async () => json });

describe('web_search', () => {
  it('parses DuckDuckGo HTML into title/url/snippet and drops private result URLs', async () => {
    const parsed = parseDuckDuckGo(DDG_HTML);
    assert.equal(parsed[0].url, 'https://example.com/docs?a=1');
    assert.equal(parsed[0].title, 'Example & Docs');
    assert.equal(parsed[0].snippet, 'The official docs.');

    const urls: string[] = [];
    const out = await webSearch('example docs', { env: {}, fetchImpl: (async (u: any) => { urls.push(String(u)); return okResponse(DDG_HTML); }) as any });
    assert.match(out, /1\. Example & Docs\n\s+https:\/\/example\.com\/docs\?a=1/);
    assert.match(out, /Other page/);
    assert.doesNotMatch(out, /localhost/);
    assert.match(urls[0], /^https:\/\/html\.duckduckgo\.com\/html\/\?q=example%20docs/);
  });

  it('uses Brave when BRAVE_SEARCH_API_KEY is set, falling through to DuckDuckGo on failure', async () => {
    const seen: string[] = [];
    const f: any = async (u: any, init: any) => {
      seen.push(String(u));
      if (String(u).includes('brave')) {
        assert.equal(init.headers['X-Subscription-Token'], 'k');
        return okResponse('', { web: { results: [{ title: 'Brave hit', url: 'https://brave.example.org/x', description: 'desc' }] } });
      }
      return okResponse(DDG_HTML);
    };
    assert.match(await webSearch('q', { env: { BRAVE_SEARCH_API_KEY: 'k' }, fetchImpl: f }), /Brave hit/);

    const failing: any = async (u: any) => (String(u).includes('brave') ? { ok: false, status: 500, headers: new Headers() } : okResponse(DDG_HTML));
    assert.match(await webSearch('q', { env: { BRAVE_SEARCH_API_KEY: 'k' }, fetchImpl: failing }), /Example & Docs/);
  });

  it('says search is unavailable instead of inventing results', async () => {
    assert.equal(await webSearch('anything', { env: {}, fetchImpl: (async () => { throw new Error('network down'); }) as any }), SEARCH_UNAVAILABLE);
    assert.equal(await webSearch('anything', { env: {}, fetchImpl: (async () => ({ ok: false, status: 503, headers: new Headers() })) as any }), SEARCH_UNAVAILABLE);
    // Unrecognised markup yields no results, not made-up ones.
    assert.equal(await webSearch('anything', { env: {}, fetchImpl: (async () => okResponse('<html>captcha</html>')) as any }), SEARCH_UNAVAILABLE);
    assert.match(SEARCH_UNAVAILABLE, /unavailable/i);
  });

  it('is exposed to the agent as a tool and returns the search text', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => okResponse(DDG_HTML)) as any;
    try {
      const model = new MockLanguageModelV4({ doStream: [step([call('1', 'web_search', { query: 'example docs' })], 'tool-calls'), step(text('done'), 'stop')] });
      const seen: string[] = [];
      await runToolAgent({ model, prompt: 'search', projectName: 'P', files: [], onEvent: (e, d: any) => e === 'react_observation' && seen.push(d.observation) });
      assert.match(seen[0], /example\.com\/docs/);
      assert.ok(toolNames(model.doStreamCalls[0]).includes('web_search'));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('SSRF guard', () => {
  const bad = [
    'http://example.com/',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.20.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://0.0.0.0/',
    'https://[::1]/',
    'https://intranet/',
    'https://db.internal/',
    'https://user:pw@example.com/',
  ];
  it('web_fetch refuses private and non-https URLs without calling fetch', async () => {
    let calls = 0;
    const f: any = async () => { calls++; return okResponse('x'); };
    for (const u of bad) assert.match(await webFetchText(u, { fetchImpl: f }), /^Error/, u);
    assert.equal(calls, 0);
    assert.match(await webFetchText('https://example.com/a', { fetchImpl: (async () => okResponse('<p>hi</p>')) as any }), /^HTTP 200\nhi/);
  });

  it('web_fetch re-checks redirects', async () => {
    const f: any = async () => ({ ok: false, status: 302, headers: new Headers({ location: 'http://169.254.169.254/' }), text: async () => '' });
    assert.match(await webFetchText('https://example.com/r', { fetchImpl: f }), /^Error: could not fetch/);
  });

  it('web_search never returns private result URLs', () => {
    for (const u of bad.filter((x) => x.startsWith('https'))) assert.ok(urlBlockReason(u), u);
    assert.equal(urlBlockReason('https://example.com'), null);
  });
});

describe('plan mode', () => {
  it('does not offer write, edit, delete, command or preview tools to the model', async () => {
    const extra = { dangerous_mcp: tool({ description: 'mutates', inputSchema: z.object({}), execute: async () => 'x' }) };
    const mk = () => new MockLanguageModelV4({ doStream: [step(text('Plan: 1. do it'), 'stop')] });

    const normal = mk();
    await runToolAgent({ model: normal, prompt: 'x', projectName: 'P', files: [], extraTools: extra });
    assert.ok(toolNames(normal.doStreamCalls[0]).includes('edit_file'));

    const planning = mk();
    const result = await runToolAgent({ model: planning, prompt: 'x', projectName: 'P', files: [], extraTools: extra, planMode: true });
    const names = toolNames(planning.doStreamCalls[0]);
    for (const banned of ['edit_file', 'write_file', 'delete_file', 'run_command', 'start_preview', 'dangerous_mcp']) assert.ok(!names.includes(banned), banned);
    for (const kept of ['read_file', 'list_files', 'grep', 'web_fetch', 'web_search', 'todo_write', 'task']) assert.ok(names.includes(kept), kept);
    assert.equal(result.text, 'Plan: 1. do it');
    assert.deepEqual(result.filesModified, []);
    assert.match(JSON.stringify(planning.doStreamCalls[0].prompt), /PLAN MODE/);
  });
});

describe('subagents (task tool)', () => {
  /** Parent calls task `n` times then answers; subagents answer with `subText`. */
  function mockModel(n: number, subText: string, onSub?: (opts: any) => void) {
    const subCalls: any[] = [];
    let parentCalls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (opts: any) => {
        if (toolNames(opts).includes('task')) {
          parentCalls++;
          if (parentCalls === 1) {
            return step(Array.from({ length: n }, (_, i) => call(`t${i}`, 'task', { description: `Find thing ${i}`, prompt: 'Find where auth is handled and report paths.' })), 'tool-calls');
          }
          return step(text('parent done'), 'stop');
        }
        subCalls.push(opts);
        onSub?.(opts);
        return step(text(subText), 'stop');
      },
    });
    return { model, subCalls };
  }

  it('caps subagents per run and keeps them read-only', async () => {
    const { model, subCalls } = mockModel(MAX_SUBAGENTS + 1, 'found it in src/auth.ts:12');
    const observations: string[] = [];
    const events: string[] = [];
    await runToolAgent({
      model, prompt: 'explore', projectName: 'P', files: [{ path: 'src/auth.ts', content: 'x' }],
      onEvent: (e, d: any) => { events.push(e); if (e === 'react_observation') observations.push(d.observation); },
    });
    assert.equal(subCalls.length, MAX_SUBAGENTS);
    assert.equal(observations.filter((o) => /subagent limit reached/.test(o)).length, 1);
    assert.equal(observations.filter((o) => /src\/auth\.ts:12/.test(o)).length, MAX_SUBAGENTS);
    for (const c of subCalls) {
      const names = toolNames(c);
      for (const banned of ['edit_file', 'write_file', 'delete_file', 'run_command', 'start_preview', 'task', 'todo_write', 'ask_user']) assert.ok(!names.includes(banned), banned);
      assert.ok(names.includes('read_file') && names.includes('grep'));
    }
    assert.ok(events.includes('subagent_start') && events.includes('subagent_done'));
  });

  it('truncates the summary returned to the parent', async () => {
    const { model } = mockModel(1, 'x'.repeat(SUBAGENT_SUMMARY_CHARS * 3));
    const observations: string[] = [];
    await runToolAgent({ model, prompt: 'explore', projectName: 'P', files: [], onEvent: (e, d: any) => e === 'react_observation' && observations.push(d.observation) });
    const summary = observations.find((o) => o.startsWith('xxx'))!;
    assert.ok(summary);
    assert.ok(summary.length <= SUBAGENT_SUMMARY_CHARS);
    assert.ok(summary.endsWith('…'));
  });

  it('passes the abort signal down to the subagent', async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const { model } = mockModel(1, 'ok', (opts) => seen.push(opts.abortSignal));
    await runToolAgent({ model, prompt: 'explore', projectName: 'P', files: [], signal: controller.signal });
    assert.equal(seen.length, 1);
    assert.ok(seen[0]);
    assert.equal(seen[0].aborted, false);
    controller.abort();
    assert.equal(seen[0].aborted, true);
  });

  it('aborted subagent yields no fake summary', async () => {
    const controller = new AbortController();
    const { model } = mockModel(1, 'ok', () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const observations: string[] = [];
    await runToolAgent({ model, prompt: 'explore', projectName: 'P', files: [], signal: controller.signal, onEvent: (e, d: any) => e === 'react_observation' && observations.push(d.observation) });
    // The abort surfaces as a tool error (never a fake summary); the real provider also stops the parent stream.
    // The aborted subagent produces no summary at all, and the aborted parent never reports success.
    assert.ok(!observations.some((o) => o === 'ok'));
    assert.ok(controller.signal.aborted);
  });
});
