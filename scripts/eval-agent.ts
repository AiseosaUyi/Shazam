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

interface TaskRun { name: string; pass: boolean; steps: number; seconds: number; error?: string; checker?: string; filesModified: string[] }

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

  const { model, modelId } = await createLanguageModel(picked.provider, picked.modelId, picked.apiKey);
  const label = `${picked.provider}/${modelId}`;
  const maxSteps = typeof args['max-steps'] === 'string' ? parseInt(args['max-steps'], 10) : 25;
  console.log(`Agent eval: ${tasks.length} task(s) on ${label}, max ${maxSteps} steps each\n`);

  const runs: TaskRun[] = [];
  for (const task of tasks) {
    const t0 = Date.now();
    const workdir = makeWorkdir();
    const files = startFiles(task);
    writeFiles(workdir, files);
    const runner = makeLocalRunner(workdir, files);
    const run: TaskRun = { name: task.name, pass: false, steps: 0, seconds: 0, filesModified: [] };
    try {
      const result = await runToolAgent({
        model,
        prompt: task.instruction,
        projectName: task.name,
        files,
        runCommand: runner.run,
        maxSteps,
        signal: AbortSignal.timeout(5 * 60_000),
      });
      run.steps = result.steps;
      run.filesModified = result.filesModified;
    } catch (err) {
      run.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }
    runner.flush();
    const check = runCheck(task, workdir);
    run.pass = check.pass;
    if (!check.pass) run.checker = check.output.split('\n').slice(0, 6).join('\n');
    run.seconds = Math.round((Date.now() - t0) / 100) / 10;
    fs.rmSync(workdir, { recursive: true, force: true });
    runs.push(run);
    console.log(`${run.pass ? 'PASS' : 'FAIL'}  ${task.name.padEnd(26)} steps=${String(run.steps).padStart(2)}  ${run.seconds}s${run.error ? `  error: ${run.error}` : ''}`);
  }

  const passed = runs.filter((r) => r.pass).length;
  const rate = passed / runs.length;
  console.log(`\nPass rate: ${passed}/${runs.length} = ${(rate * 100).toFixed(0)}%  (target >= 60%)`);

  const report = { build: gitSha(), date: new Date().toISOString(), model: label, maxSteps, passed, total: runs.length, passRate: rate, tasks: runs };
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
