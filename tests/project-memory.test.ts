import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectMemory, stripLineNumbers, MEMORY_FILES } from '@/lib/runs/project-memory';

describe('stripLineNumbers', () => {
  it('removes leading number tabs from each line', () => {
    const input = '1\tFirst line\n2\tSecond line\nnormal line';
    const result = stripLineNumbers(input);
    assert.equal(result, 'First line\nSecond line\nnormal line');
  });

  it('leaves lines without number tabs unchanged', () => {
    const input = 'no numbers here\n   indented but no tab-number';
    assert.equal(stripLineNumbers(input), input);
  });
});

describe('loadProjectMemory', () => {
  function makeReadFile(files: Record<string, string>) {
    return async (p: string): Promise<string> => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    };
  }

  it('returns the first usable file (ARCWORK.md wins over AGENTS.md and CLAUDE.md)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));
    const root = tmp;
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'agents note');
    fs.writeFileSync(path.join(root, 'ARCWORK.md'), 'arcwork note');

    const memory = await loadProjectMemory(makeReadFile({ [`${root}/ARCWORK.md`]: 'arcwork note', [`${root}/AGENTS.md`]: 'agents note' }), root);
    assert.ok(memory.startsWith('## Project memory (ARCWORK.md)'));
    assert.ok(memory.includes('arcwork note'));
  });

  it('falls back to CLAUDE.md when ARCWORK.md and AGENTS.md error out', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));
    const root = tmp;
    const files: Record<string, string> = {};

    async function failingRead(p: string): Promise<string> {
      if (p.includes('ARCWORK')) throw new Error('boom');
      if (p.includes('AGENTS')) return 'Error: not found';
      return 'claudes note';
    }

    // Provide only CLAUDE.md as a real file for the readFile to succeed
    const testFiles: Record<string, string> = {};
    testFiles[`${root}/CLAUDE.md`] = 'claudes note';

    const memory = await loadProjectMemory(async (p: string) => {
      if (p.includes('ARCWORK')) throw new Error('boom');
      if (p.includes('AGENTS')) return 'Error: not found';
      return testFiles[p] ?? Promise.reject(new Error('missing'));
    }, root);

    assert.ok(memory.startsWith('## Project memory (CLAUDE.md)'));
    assert.ok(memory.includes('claudes note'));
  });

  it('falls back when ARCWORK throws and AGENTS returns Error: prefix', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));
    const files: Record<string, string> = {};
    files[`${root}/CLAUDE.md`] = 'the claudes content';

    const memory = await loadProjectMemory(async (p) => {
      if (p.includes('ARCWORK')) throw new Error('no file');
      if (p.includes('AGENTS')) return 'Error: something broke';
      return files[p] ?? Promise.reject(new Error(''));
    }, root);

    assert.ok(memory.startsWith('## Project memory (CLAUDE.md)'));
  });

  it('skips blank-after-trim files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));
    const files: Record<string, string> = {};
    files[`${root}/ARCWORK.md`] = '';
    files[`${root}/AGENTS.md`] = '   \n\n  ';
    files[`${root}/CLAUDE.md`] = 'winning';

    const memory = await loadProjectMemory(async (p) => {
      return files[p] ?? Promise.reject(new Error(''));
    }, root);

    assert.ok(memory.startsWith('## Project memory (CLAUDE.md)'));
  });

  it('truncates content and adds "…(truncated)" when exceeding maxChars', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));
    const longContent = 'x'.repeat(100);
    const files: Record<string, string> = {};
    files[`${root}/ARCWORK.md`] = longContent;

    const memory = await loadProjectMemory(async (p) => files[p] ?? Promise.reject(new Error('')), root, 50);
    assert.ok(memory.includes('…(truncated)'));
    // The header + content should be within maxChars approximately
    const truncatedIdx = memory.indexOf('…(truncated)');
    assert.ok(truncatedIdx > 0);
    assert.ok(memory.length >= 50);
  });

  it('returns only the guidance paragraph when no files are usable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));

    const memory = await loadProjectMemory(async (p) => {
      if (p.includes('ARCWORK')) throw new Error('nope');
      if (p.includes('AGENTS')) return 'Error: fail';
      if (p.includes('CLAUDE')) return '';
      return '';
    }, root);

    // When no file is usable, should return only the guidance paragraph
    assert.ok(memory.includes('## Project memory') === false, 'should not include ## Project memory header');
    assert.ok(memory.includes('ARCWORK.md'), 'guidance paragraph should mention ARCWORK.md');
    // The full guidance should be present
    const expectedGuidanceEnd = 'Never store secrets there.';
    assert.ok(memory.includes(expectedGuidanceEnd));
  });

  it('the guidance is always present', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-'));
    const files: Record<string, string> = {};
    files[`${root}/ARCWORK.md`] = 'some content';

    const memory = await loadProjectMemory(async (p) => files[p] ?? Promise.reject(new Error('')), root);
    assert.ok(memory.includes('Never store secrets there.'));
  });
});
