import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReActTurn, executeReActLoop, buildReActSystemPrompt } from '../src/lib/agent/react_engine';

describe('Autonomous ReAct Agent Engine Tests', () => {
  it('parses structured THOUGHT and ACTION tool calls accurately', () => {
    const raw = `THOUGHT: I need to check the authentication configuration.
ACTION: read_file {"path": "src/lib/auth.ts", "startLine": 1, "endLine": 20}`;

    const parsed = parseReActTurn(raw);
    assert.ok(parsed);
    assert.equal(parsed.thought, 'I need to check the authentication configuration.');
    assert.equal(parsed.tool, 'read_file');
    assert.equal(parsed.args.path, 'src/lib/auth.ts');
  });

  it('runs multi-step autonomous tool execution with surgical editing and verification', async () => {
    const files = [
      { path: 'src/config.ts', content: 'export const DEBUG = false;\nexport const TIMEOUT = 1000;' },
    ];

    let turnCount = 0;
    const mockLLM = async (messages: Array<{ role: string; content: string }>) => {
      turnCount++;
      if (turnCount === 1) {
        return `THOUGHT: I will enable debug mode in config.
ACTION: edit_file {"path": "src/config.ts", "searchBlock": "DEBUG = false;", "replaceBlock": "DEBUG = true;"}`;
      } else if (turnCount === 2) {
        return `THOUGHT: Now I verify by reading the file.
ACTION: read_file {"path": "src/config.ts", "startLine": 1, "endLine": 2}`;
      } else {
        return `THOUGHT: Changes are verified and working.
ACTION: finish_task {"summary": "Debug mode enabled successfully in config.ts."}`;
      }
    };

    const result = await executeReActLoop('Enable debug mode in config.ts', {
      projectName: 'Test Workspace',
      files,
      invokeLLM: mockLLM,
    });

    assert.equal(result.success, true);
    assert.equal(result.steps.length, 3);
    assert.ok(files[0].content.includes('DEBUG = true;'));
    assert.ok(result.filesModified.includes('src/config.ts'));
    assert.ok(result.finalSummary.includes('Debug mode enabled'));
  });
});
