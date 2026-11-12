/**
 * C11 agent benchmark: runs the real native tool-calling loop (runToolAgent) on 20 small SWE-style
 * tasks inside local temp dirs, then runs each task's deterministic checker.
 *
 *   npm run eval:agent -- [--model provider/id] [--local] [--limit N] [--task name] [--json out.json]
 *                         [--min-pass 0.6] [--max-steps N] [--env path]
 *   npm run eval:agent:dry            (no model: checks every task fails on start and passes on solution/)
 *
 * Model ids look like "google/gemini-3.8-flash", "cerebras/gpt-oss-120b", "openrouter/<id>:free",
 * "groq/<id>", "ollama/<tag>". Keys come from the environment or .env.local; they are never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { createLanguageModel } from '../src/lib/agent/models';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LOCAL_STEP_TIMEOUT_MS, withLocalDefaults } from '../src/lib/agent/local-llm';
import { loadEnvFile, loadTasks, makeLocalRunner, makeWorkdir, runCheck, startFiles, writeFiles } from '../evals/agent/lib';
import { validateAll } from '../evals/agent/validate';

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { a[key] = next; i++; } else a[key] = true;
  }
  return a;
}

/** Free-tier defaults, mirrored from src/lib/agent/resolve.ts FREE_BYOK (Groq last: its free limits are tight). */
const FREE_DEFAULTS: Array<{ provider: string; modelId: string; keys: string[] }> = [
  { provider: 'google', modelId: 'gemini-3.8-flash', keys: ['GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] },
  { provider: 'cerebras', modelId: 'gpt-oss-120b', keys: ['CEREBRAS_API_KEY'] },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', keys: ['OPENROUTER_API_KEY'] },
  { provider: 'groq', modelId: 'qwen/qwen3.8-27b', keys: ['GROQ_API_KEY'] },
];
const firstKey = (names: string[]) => names.map((n) => process.env[n]).find(Boolean) || '';

function pickModel(args: Record<string, string | boolean>): { provider: string; modelId: string; apiKey: string } | { error: string } {
  const explicit = typeof args.model === 'string' ? args.model : process.env.EVAL_MODEL;
  if (args.local || (explicit && explicit.startsWith('ollama/'))) {
    const id = explicit?.startsWith('ollama/') ? explicit.slice(7) : process.env.EVAL_LOCAL_MODEL || 'qwen3.6:35b-a3b';
    return { provider: 'ollama', modelId: id, apiKey: '' };
  }
  if (explicit) {
    const i = explicit.indexOf('/');
    if (i < 1) return { error: `--model must look like provider/model-id (got "${explicit}")` };
    const provider = explicit.slice(0, i);
    const modelId = explicit.slice(i + 1);
    const known = FREE_DEFAULTS.find((d) => d.provider === provider);
    const apiKey = provider === 'gateway' ? '' : firstKey(known?.keys || [`${provider.toUpperCase()}_API_KEY`]);
    if (!apiKey && provider !== 'gateway') return { error: `no API key in env for provider "${provider}"` };
    return { provider, modelId, apiKey };
  }
  for (const d of FREE_DEFAULTS) {
    const apiKey = firstKey(d.keys);
    if (apiKey) return { provider: d.provider, modelId: d.modelId, apiKey };
  }
  return { error: 'no free-model key found (set GOOGLE_AI_API_KEY / GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY or GROQ_API_KEY in .env.local, or pass --local for Ollama)' };
}

function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

interface TaskRun { name: string; pass: boolean; quota?: boolean; steps: number; firstEditStep?: number; summary?: string; seconds: number; error?: string; checker?: string; filesModified: string[] }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let tasks = loadTasks();
  if (typeof args.task === 'string') tasks = tasks.filter((t) => t.name === args.task);
  if (typeof args.limit === 'string') tasks = tasks.slice(0, Math.max(0, parseInt(args.limit, 10) || 0));
  if (!tasks.length) { console.error('No tasks selected.'); process.exit(1); }

  if (args.dry) {
    const results = validateAll(tasks);
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'BAD '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    const good = results.filter((r) => r.ok).length;
    console.log(`\nDry validation: ${good}/${results.length} tasks valid (checker fails on start, passes on solution)`);
    process.exit(good === results.length ? 0 : 1);
  }

  for (const f of [typeof args.env === 'string' ? args.env : '', path.join(ROOT, '.env.local')]) if (f) loadEnvFile(f);
  const picked = pickModel(args);
  if ('error' in picked) { console.error(picked.error); process.exit(2); }

  // A local Ollama model gets the same treatment as in production (src/lib/agent/local-llm.ts): thinking on
  // with an output cap, a per-step time limit, and one quick no-thinking retry when a step runs away.
  // Without this the eval hangs for the whole task limit on a single runaway generation.
  let model: any;
  let modelId: string;
  if (picked.provider === 'ollama') {
    const base = `${process.env.OLLAMA_HOST || 'http://localhost:11434'}/v1`;
    // Like the bridge in production, buffer the whole reply: the time limit then covers the full step
    // (a streamed reply would only time out mid-stream, with no chance to retry without thinking).
    const stepFetch: typeof fetch = async (url, init) => {
      const attempt = async (thinking: 'on' | 'off', ms: number) => {
        const res = await fetch(url, { ...init, body: withLocalDefaults(init?.body as string | undefined, thinking), signal: AbortSignal.any([...(init?.signal ? [init.signal as AbortSignal] : []), AbortSignal.timeout(ms)]) });
        const body = await res.text();
        return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      };
      try {
        return await attempt('on', LOCAL_STEP_TIMEOUT_MS);
      } catch (err) {
        if (init?.signal?.aborted) throw err;
        return attempt('off', 90_000);
      }
    };
    modelId = picked.modelId;
    model = createOpenAICompatible({ name: 'ollama', baseURL: base, fetch: stepFetch })(modelId);
  } else {
    ({ model, modelId } = await createLanguageModel(picked.provider, picked.modelId, picked.apiKey));
  }
  const label = `${picked.provider}/${modelId}`;
  const maxSteps = typeof args['max-steps'] === 'string' ? parseInt(args['max-steps'], 10) : 25;
  console.log(`Agent eval: ${tasks.length} task(s) on ${label}, max ${maxSteps} steps each\n`);

  const runs: TaskRun[] = [];
  const pauseSec = typeof args.pause === 'string' ? Math.max(0, parseInt(args.pause, 10) || 0) : 0;
  const isQuota = (e?: string) => Boolean(e && /quota|rate.?limit|429|resource.?exhausted|too many requests/i.test(e));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const task of tasks) {
    let run!: TaskRun;
    // Free API tiers allow a few requests a minute. A quota error is not a wrong answer: wait out the
    // window and retry up to twice, and report tasks that still hit the quota separately.
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = Date.now();
      const workdir = makeWorkdir();
      const files = startFiles(task);
      writeFiles(workdir, files);
      const runner = makeLocalRunner(workdir, files);
      run = { name: task.name, pass: false, steps: 0, seconds: 0, filesModified: [] };
      let toolCalls = 0;
      try {
        const result = await runToolAgent({
          model,
          prompt: task.instruction,
          projectName: task.name,
          files,
          runCommand: runner.run,
          maxSteps: task.maxSteps ?? maxSteps,
          signal: AbortSignal.timeout((task.maxMinutes ?? 5) * 60_000),
          onEvent: (event) => {
            if (event === 'react_step') toolCalls++;
            else if (event === 'file_changed' && run.firstEditStep === undefined) run.firstEditStep = toolCalls;
          },
        });
        run.steps = result.steps;
        run.filesModified = result.filesModified;
        run.summary = result.text.slice(0, 1200);
      } catch (err) {
        run.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      }
      runner.flush();
      const check = runCheck(task, workdir);
      run.pass = check.pass;
      // Some tasks also require the agent to start editing promptly (no endless exploring).
      if (run.pass && task.maxStepsToFirstEdit && (run.firstEditStep === undefined || run.firstEditStep > task.maxStepsToFirstEdit)) {
        run.pass = false;
        run.checker = `first edit at step ${run.firstEditStep ?? 'never'}, limit ${task.maxStepsToFirstEdit}`;
      }
      if (!check.pass) run.checker = check.output.split('\n').slice(0, 6).join('\n');
      run.seconds = Math.round((Date.now() - t0) / 100) / 10;
      fs.rmSync(workdir, { recursive: true, force: true });
      if (!run.pass && isQuota(run.error)) {
        run.quota = true;
        if (attempt < 2) {
          console.log(`WAIT  ${task.name.padEnd(26)} hit the API quota; waiting 65s then retrying (${attempt + 1}/2)`);
          await sleep(65_000);
          continue;
        }
      }
      break;
    }
    runs.push(run);
    console.log(`${run.pass ? 'PASS' : run.quota ? 'QUOTA' : 'FAIL'}  ${task.name.padEnd(26)} steps=${String(run.steps).padStart(2)}  ${run.seconds}s${run.error ? `  error: ${run.error.slice(0, 120)}` : ''}`);
    if (pauseSec) await sleep(pauseSec * 1000);
  }

  const passed = runs.filter((r) => r.pass).length;
  const blocked = runs.filter((r) => r.quota && !r.pass).length;
  const scored = runs.length - blocked;
  const rate = scored ? passed / scored : 0;
  console.log(`\nPass rate: ${passed}/${scored} = ${(rate * 100).toFixed(0)}%  (target >= 60%)${blocked ? `  [${blocked} task(s) not scored: API quota]` : ''}`);

  const report = { build: gitSha(), date: new Date().toISOString(), model: label, maxSteps, passed, total: scored, quotaBlocked: blocked, passRate: rate, tasks: runs };
  const resultsDir = path.join(ROOT, 'evals/agent/results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const auto = path.join(resultsDir, `${report.date.replace(/[:.]/g, '-')}_${report.build}.json`);
  fs.writeFileSync(auto, JSON.stringify(report, null, 2));
  if (typeof args.json === 'string') fs.writeFileSync(path.resolve(args.json), JSON.stringify(report, null, 2));
  console.log(`Results: ${path.relative(ROOT, auto)}`);

  const min = typeof args['min-pass'] === 'string' ? parseFloat(args['min-pass']) : null;
  process.exit(min !== null && rate < min ? 1 : 0);
}

main().catch((err) => {
  console.error('Eval harness crashed:', err instanceof Error ? err.message : err);
  process.exit(3);
});
