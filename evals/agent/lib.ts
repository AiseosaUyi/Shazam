import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

/** Shared helpers for the agent eval (C11): task loading, temp workdirs, checkers, local executor. */

export interface EvalTask {
  name: string;
  instruction: string;
  dir: string;
}

export interface AgentFile {
  path: string;
  content: string;
}

export const TASKS_DIR = path.resolve(__dirname, 'tasks');
const SKIP_DIRS = new Set(['node_modules', '.git']);

export function loadTasks(dir = TASKS_DIR): EvalTask[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const taskDir = path.join(dir, d.name);
      const meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8')) as { name: string; instruction: string };
      return { name: meta.name, instruction: meta.instruction, dir: taskDir };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readTree(root: string, rel = ''): AgentFile[] {
  const out: AgentFile[] = [];
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...readTree(root, r));
    else out.push({ path: r, content: fs.readFileSync(path.join(root, r), 'utf8') });
  }
  return out;
}

export function writeFiles(root: string, files: AgentFile[]) {
  for (const f of files) {
    const p = path.join(root, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
}

export function makeWorkdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arcwork-eval-'));
}

export function startFiles(task: EvalTask): AgentFile[] {
  return readTree(path.join(task.dir, 'start'));
}

/** Runs the task's check.js with cwd = workdir. Pass = exit code 0. */
export function runCheck(task: EvalTask, workdir: string): { pass: boolean; output: string } {
  // Drop NODE_TEST_CONTEXT so nested 'node --test' runs inside checkers behave when this runs under 'npm test'.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(task.dir, 'check.js')], { cwd: workdir, encoding: 'utf8', timeout: 60_000, env });
  const output = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { pass: r.status === 0, output: output.slice(-1500) };
}

/**
 * A command runner for runToolAgent that executes in a local temp dir. The agent edits an in-memory
 * `files` array, so files are flushed to disk before each command and read back afterwards.
 */
export function makeLocalRunner(workdir: string, files: AgentFile[], timeoutMs = 60_000) {
  const flush = () => {
    const keep = new Set(files.map((f) => f.path));
    for (const f of readTree(workdir)) if (!keep.has(f.path)) fs.rmSync(path.join(workdir, f.path), { force: true });
    writeFiles(workdir, files);
  };
  const pull = () => {
    const disk = readTree(workdir);
    const onDisk = new Set(disk.map((f) => f.path));
    for (let i = files.length - 1; i >= 0; i--) if (!onDisk.has(files[i].path)) files.splice(i, 1);
    for (const d of disk) {
      const f = files.find((x) => x.path === d.path);
      if (f) f.content = d.content;
      else files.push(d);
    }
  };
  const run = (command: string, signal?: AbortSignal) =>
    new Promise<{ exitCode: number; output: string }>((resolve) => {
      flush();
      const child = spawn('bash', ['-c', command], { cwd: workdir, env: { ...process.env, CI: '1', NO_COLOR: '1' }, signal });
      let output = '';
      const cap = (b: Buffer) => { if (output.length < 200_000) output += b.toString(); };
      child.stdout.on('data', cap);
      child.stderr.on('data', cap);
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      const done = (exitCode: number, extra = '') => {
        clearTimeout(timer);
        pull();
        resolve({ exitCode, output: output + extra });
      };
      child.on('error', (e) => done(1, `\n${e.message}`));
      child.on('close', (code) => done(code ?? 124));
    });
  return { run, flush, pull };
}

/** Parses KEY=VALUE lines of an env file into process.env without overriding existing values. Never prints values. */
export function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return true;
}
