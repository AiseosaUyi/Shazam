import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent, applyEdit } from '../src/lib/agent/tool_agent';

const usage: any = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function step(parts: any[], unified: 'tool-calls' | 'stop'): any {
  return {
    stream: simulateReadableStream({
      chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }],
    }),
  };
}

const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

describe('Native tool-calling coding agent', () => {
  it('explores, writes and edits files through real tool calls, then summarizes', async () => {
    const files = [{ path: 'src/config.ts', content: 'export const DEBUG = false;\n' }];
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'read_file', { path: 'src/config.ts' })], 'tool-calls'),
        step([call('2', 'edit_file', { path: 'src/config.ts', old_string: 'DEBUG = false', new_string: 'DEBUG = true' }), call('3', 'write_file', { path: 'src/todo.ts', content: 'export const todos: string[] = [];\n' })], 'tool-calls'),
        step([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Enabled DEBUG and added src/todo.ts. Not executed.' }, { type: 'text-end', id: 't' }], 'stop'),
      ],
    });

    const observations: string[] = [];
    const result = await runToolAgent({
      model,
      prompt: 'enable debug and add a todo module',
      projectName: 'Test',
      files,
      onEvent: (e, d: any) => { if (e === 'react_observation') observations.push(d.observation); },
    });

    assert.equal(files.find((f) => f.path === 'src/config.ts')?.content, 'export const DEBUG = true;\n');
    assert.ok(files.some((f) => f.path === 'src/todo.ts'));
    assert.deepEqual(result.filesModified.sort(), ['src/config.ts', 'src/todo.ts']);
    assert.match(observations[0], /1\texport const DEBUG = false;/);
    assert.match(result.text, /Not executed/);
    assert.ok(!files.some((f) => f.path === 'src/App.tsx'));

    // The tool definitions were really sent to the provider, not described in prose.
    const firstCall = model.doStreamCalls[0] as any;
    const toolNames = (firstCall.tools || []).map((t: any) => t.name);
    assert.ok(toolNames.includes('edit_file') && toolNames.includes('run_command'));
  });

  it('runs commands through the provided runner and reports NOT RUN without one', async () => {
    const mk = () => new MockLanguageModelV4({
      doStream: [step([call('1', 'run_command', { command: 'npm test' })], 'tool-calls'), step([], 'stop')],
    });
    const seen: string[] = [];
    await runToolAgent({ model: mk(), prompt: 'test', projectName: 'P', files: [], onEvent: (e, d: any) => e === 'react_observation' && seen.push(d.observation) });
    assert.match(seen[0], /^NOT RUN/);

    const ran: string[] = [];
    const out = await runToolAgent({
      model: mk(), prompt: 'test', projectName: 'P', files: [],
      runCommand: async (cmd) => { ran.push(cmd); return { exitCode: 1, output: '1 failing' }; },
      onEvent: (e, d: any) => e === 'react_observation' && seen.push(d.observation),
    });
    assert.deepEqual(ran, ['npm test']);
    assert.match(seen[1], /exit code: 1/);
    assert.deepEqual(out.commandsRun, [{ command: 'npm test', exitCode: 1 }]);
  });

  it('blocks secret paths and tolerates re-indented old_string', async () => {
    const model = new MockLanguageModelV4({ doStream: [step([call('1', 'write_file', { path: '.env', content: 'K=1' })], 'tool-calls'), step([], 'stop')] });
    const seen: string[] = [];
    await runToolAgent({ model, prompt: 'x', projectName: 'P', files: [], onEvent: (e, d: any) => e === 'react_observation' && seen.push(d.observation) });
    assert.match(seen[0], /Blocked by safety policy/);

    const r = applyEdit('function a() {\n    return 1;\n}\n', 'return 1;', 'return 2;');
    assert.ok(r.ok && r.content.includes('return 2;'));
    const fuzzy = applyEdit('if (x) {\n\t\tgo();\n}\n', 'if (x) {\n  go();\n}', 'if (x) {\n  stop();\n}');
    assert.ok(fuzzy.ok && fuzzy.content.includes('stop();'));
  });
});
