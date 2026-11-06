import fs from 'node:fs';
import path from 'node:path';
import { loadTasks, makeWorkdir, readTree, runCheck, startFiles, writeFiles, type EvalTask } from './lib';

export interface DryResult {
  name: string;
  startFails: boolean;
  solutionPasses: boolean;
  ok: boolean;
  detail: string;
}

/** Self-verification: the checker must FAIL on the starting files and PASS once solution/ is applied. */
export function validateTask(task: EvalTask): DryResult {
  const solutionDir = path.join(task.dir, 'solution');
  if (!fs.existsSync(solutionDir)) return { name: task.name, startFails: false, solutionPasses: false, ok: false, detail: 'missing solution/' };

  const a = makeWorkdir();
  const b = makeWorkdir();
  try {
    writeFiles(a, startFiles(task));
    const start = runCheck(task, a);

    writeFiles(b, startFiles(task));
    writeFiles(b, readTree(solutionDir));
    const sol = runCheck(task, b);

    const ok = !start.pass && sol.pass;
    const detail = ok ? '' : !sol.pass ? `solution fails checker: ${sol.output.split('\n').slice(0, 4).join(' | ')}` : 'checker passes on the unmodified starting files';
    return { name: task.name, startFails: !start.pass, solutionPasses: sol.pass, ok, detail };
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
}

export function validateAll(tasks = loadTasks()): DryResult[] {
  return tasks.map(validateTask);
}
