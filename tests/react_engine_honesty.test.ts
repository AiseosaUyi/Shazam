import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReActTurn, executeReActLoop } from '../src/lib/agent/react_engine';
import { deriveConversationTitle } from '../src/lib/execution/orchestrator';

describe('ReAct engine honesty and robustness', () => {
  it('parses ACTION JSON whose string values contain braces and trailing prose', () => {
    const raw = `THOUGHT: create it
ACTION: create_file {"path": "src/a.ts", "content": "export function f() { return { ok: true }; }"}
I will verify next.`;
    const parsed = parseReActTurn(raw);
    assert.ok(parsed);
    assert.equal(parsed.tool, 'create_file');
    assert.equal(parsed.args.content, 'export function f() { return { ok: true }; }');
  });

  it('never fabricates passing command output when no bridge is connected', async () => {
    let turn = 0;
    const seen: string[] = [];
    const result = await executeReActLoop('run tests', {
      projectName: 'P',
      files: [{ path: 'src/a.ts', content: 'x' }],
      invokeLLM: async (messages) => {
        seen.push(messages[messages.length - 1].content);
        turn++;
        if (turn === 1) return 'THOUGHT: test\nACTION: run_command {"command": "npm test"}';
        return 'THOUGHT: done\nACTION: finish_task {"summary": "Tests not run."}';
      },
    });
    assert.match(seen[1], /NOT RUN/);
    assert.doesNotMatch(seen[1], /All syntax checks/);
    assert.equal(result.steps[0].isError, true);
  });

  it('nudges a prose-only reply back into the tool protocol instead of declaring success', async () => {
    let turn = 0;
    const files: Array<{ path: string; content: string }> = [];
    const result = await executeReActLoop('make a file', {
      projectName: 'P',
      files,
      invokeLLM: async () => {
        turn++;
        if (turn === 1) return 'Here is the code:\n```ts\nconst a = 1;\n```';
        if (turn === 2) return 'THOUGHT: write\nACTION: create_file {"path": "src/a.ts", "content": "const a = 1;"}';
        return 'THOUGHT: done\nACTION: finish_task {"summary": "Created src/a.ts"}';
      },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.filesModified, ['src/a.ts']);
  });

  it('blocks writes to secret files and supports list_files / search_code', async () => {
    let turn = 0;
    const observations: string[] = [];
    await executeReActLoop('x', {
      projectName: 'P',
      files: [{ path: 'src/auth.ts', content: 'export const TOKEN_TTL = 60;' }],
      invokeLLM: async (messages) => {
        observations.push(messages[messages.length - 1].content);
        turn++;
        if (turn === 1) return 'THOUGHT: a\nACTION: create_file {"path": ".env", "content": "K=1"}';
        if (turn === 2) return 'THOUGHT: b\nACTION: list_files {"prefix": "src/"}';
        if (turn === 3) return 'THOUGHT: c\nACTION: search_code {"query": "token_ttl"}';
        return 'THOUGHT: d\nACTION: finish_task {"summary": "ok"}';
      },
    });
    assert.match(observations[1], /Blocked by safety policy/);
    assert.match(observations[2], /src\/auth\.ts/);
    assert.match(observations[3], /src\/auth\.ts:1:/);
  });

  it('titles conversations from the user request, not the instruction preamble', () => {
    const prompt = 'You are Shazam AI — an expert AI software engineer.\nBe helpful.\n\nUser Request:\nBuild a todo CLI';
    assert.equal(deriveConversationTitle(prompt), 'Build a todo CLI');
    assert.equal(deriveConversationTitle('[Autonomous Co-Work Session in Shazam AI]\nActive Connector: Gmail\nUser Request:\nEmail Sam'), 'Email Sam');
  });
});
