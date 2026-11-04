/**
 * Automatic verification after a local code task: run git diff --numstat,
 * parse test-line deletions, execute the project test suite, and produce
 * a short markdown summary.
 */

// ── helpers ────────────────────────────────────────────────────────────

/** Parse `git diff --numstat` output into per-file row objects. */
export function parseNumstat(out: string): Array<{ path: string; added: number; removed: number }> {
  const rows: Array<{ path: string; added: number; removed: number }> = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip binary rows: `-\t-\tpath`
    if (trimmed.startsWith('-\t-')) continue;
    const tabIdx = trimmed.indexOf('\t');
    if (tabIdx === -1) continue;
    const addedStr = trimmed.slice(0, tabIdx).trim();
    const rest = trimmed.slice(tabIdx + 1);
    const tab2 = rest.indexOf('\t');
    if (tab2 === -1) continue;
    const removedStr = rest.slice(0, tab2).trim();
    const path = rest.slice(tab2 + 1).trim();
    const added = Number(addedStr);
    const removed = Number(removedStr);
    if (!Number.isNaN(added) && !Number.isNaN(removed)) {
      rows.push({ path, added, removed });
    }
  }
  return rows;
}

/** True for paths that look like test files / directories. */
export function isTestPath(p: string): boolean {
  // Directory-based: (tests?|__tests__) as a segment
  if (/(^|\/)(tests?|__tests__|spec)\//.test(p)) return true;
  // File-name-based: .test. or .spec.
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p)) return true;
  return false;
}

/** For test files whose rows have removed > 0, build warning strings. */
export function testWarnings(rows: Array<{ path: string; added: number; removed: number }>): string[] {
  const warnings: string[] = [];
  for (const row of rows) {
    if (row.removed > 0 && isTestPath(row.path)) {
      warnings.push(`${row.path}: ${row.removed} test line(s) removed`);
    }
  }
  return warnings;
}

/** Extract the last `exit code: N` line from output; default 1 on failure. */
export function exitCodeOf(out: string): number {
  const lines = out.split('\n');
  let lastMatch = 1; // default
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/exit code:\s*(\d+)/i);
    if (m) lastMatch = Number(m[1]);
  }
  return lastMatch;
}

// ── public types & entry point ─────────────────────────────────────────

/** Execute a shell command in the user's folder. */
export type Exec = (command: string, timeoutMs: number) => Promise<string>;

/** Build a markdown verification summary and decide ok / not-ok. */
export async function autoVerify(
  exec: Exec,
  readFile: (p: string) => Promise<string>,
  root: string,
): Promise<{ summary: string; ok: boolean }> {
  // 1 — diff
  const diff = await exec('git diff --numstat HEAD', 30_000);
  let rows: Array<{ path: string; added: number; removed: number }> = [];
  if (exitCodeOf(diff) !== 0) {
    rows = [];
  } else {
    rows = parseNumstat(diff);
  }

  // 2 — test suite
  let pkgRaw = '';
  try {
    pkgRaw = await readFile(root + '/package.json');
    // strip leading line numbers from read_file output
    pkgRaw = pkgRaw.replace(/^\s*\d+\t/gm, '');
  } catch {
    pkgRaw = '{}';
  }

  let testsPassed: boolean | null = null;
  try {
    const pkg = JSON.parse(pkgRaw);
    if (typeof pkg.scripts?.test === 'string' && !pkg.scripts.test.includes('no test specified')) {
      const t = await exec(
        'npm test --silent > /tmp/arcwork-verify.log 2>&1; code=$?; tail -40 /tmp/arcwork-verify.log; echo "exit code: $code"',
        300_000,
      );
      testsPassed = exitCodeOf(t) === 0;
    }
    // else no test script → testsPassed stays null
  } catch {
    testsPassed = null;
  }

  // 3 — warnings from numstat
  const warnings = testWarnings(rows);

  // 4 — build summary
  const lines: string[] = [];
  lines.push('### Verified by Arcwork');
  lines.push('');

  // Tests line
  if (testsPassed === true) {
    lines.push('Tests: passed');
  } else if (testsPassed === false) {
    lines.push('Tests: FAILED (exit 1)');
  } else {
    lines.push('Tests: no test script');
  }
  lines.push('');

  // Files changed
  lines.push(`Files changed: ${rows.length}`);
  lines.push('');

  if (warnings.length > 0) {
    lines.push('⚠️ Test lines removed:');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  const summary = lines.join('\n');

  // ok = testsPassed is not false AND no test deletions
  const ok = testsPassed !== false && warnings.length === 0;

  return { summary, ok };
}
