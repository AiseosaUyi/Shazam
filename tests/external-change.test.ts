import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { buildReport } from '../src/lib/runs/report';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

/** A fake local folder with one file that the "user" can change behind the run's back. */
function fakeLocal(initial: string) {
  const disk = new Map<string, string>([['/r/a.ts', initial]]);
  const written: string[] = [];
  const local = {
    root: '/r', deviceName: 'T',
    call: async (command: string, payload: any) => {
      if (command === 'list_files') return 'a.ts';
      if (command === 'read_file') return disk.has(payload.path) ? disk.get(payload.path)!.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n') : 'Error: missing';
      if (command === 'edit_file') {
        const cur = disk.get(payload.path)!;
        if (!cur.includes(payload.old_string)) return 'Error: old_string not found';
        disk.set(payload.path, cur.replace(payload.old_string, payload.new_string));
        written.push(payload.path);
        return `Edited ${payload.path}.`;
      }
      if (command === 'exec') return 'exit code: 0\n';
      return 'Error: unsupported';
    },
  };
  return { disk, local, written };
}

describe('External change detection (P2-A)', () => {
  it('holds back an edit when the file changed after it was read, and shows the fresh view', async () => {
    const { disk, local, written } = fakeLocal('export const a = 1;\n');
    const events: string[] = [];
    const obs: string[] = [];
    let n = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        n++;
        if (n === 1) return step([call('1', 'read_file', { path: 'a.ts' })], 'tool-calls');
        if (n === 2) {
          disk.set('/r/a.ts', 'export const a = 1;\n// added by the user\n'); // someone else edits
          return step([call('2', 'edit_file', { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' })], 'tool-calls');
        }
        if (n === 3) return step([call('3', 'edit_file', { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' })], 'tool-calls');
        return step(text('done'), 'stop');
      },
    });
    const r = await runToolAgent({ model, prompt: 'Change a to 2', projectName: 'P', files: [], local, onEvent: (e, d: any) => { events.push(e); if (e === 'react_observation') obs.push(d.observation); } });
    assert.ok(events.includes('external_change'));
    assert.match(obs[1], /EXTERNAL CHANGE: a\.ts was modified by someone else/);
    assert.match(obs[1], /added by the user/, 'fresh view shown');
    assert.equal(written.length, 1, 'first attempt held back, second applied');
    assert.equal(disk.get('/r/a.ts'), 'export const a = 2;\n// added by the user\n', 'their change is kept');
    assert.deepEqual(r.externalChanges, ['a.ts']);
    assert.equal(r.edits.length, 1);
  });

  it('does not fire when nothing changed, or for the run\'s own edits', async () => {
    const { local } = fakeLocal('export const a = 1;\nexport const b = 2;\n');
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'read_file', { path: 'a.ts' })], 'tool-calls'),
        step([call('2', 'edit_file', { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' })], 'tool-calls'),
        step([call('3', 'edit_file', { path: 'a.ts', old_string: 'b = 2', new_string: 'b = 3' })], 'tool-calls'),
        step(text('done'), 'stop'),
      ],
    });
    const r = await runToolAgent({ model, prompt: 'Change a and b', projectName: 'P', files: [], local });
    assert.deepEqual(r.externalChanges, []);
    assert.equal(r.edits.length, 2);
  });

  it('appears as a warning in the run report', () => {
    const report = buildReport({ prompt: 'Change a', record: { edits: [{ path: 'a.ts', action: 'edit', added: 1, removed: 1 }], commands: [], external: ['a.ts'] } });
    assert.ok(report.warnings.includes('external_changes_detected'));
    assert.match(report.warnings.join(' '), /Changed by someone else during the run.*a\.ts/);
  });
});
