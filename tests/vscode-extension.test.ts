import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildInlinePrompt, extractCodeBlock } from '../extensions/vscode/src/extension';

describe('Shazam VS Code Extension Core Tests', () => {
  it('constructs disciplined inline Cmd+K prompts with selection and surrounding context', () => {
    const prompt = buildInlinePrompt(
      'Convert this to TypeScript with strict types',
      'function add(a, b) { return a + b; }',
      'const x = 10;\nfunction add(a, b) { return a + b; }\nconsole.log(add(1, 2));'
    );

    assert.ok(prompt.includes('Instruction: Convert this to TypeScript with strict types'));
    assert.ok(prompt.includes('function add(a, b) { return a + b; }'));
    assert.ok(prompt.includes('Output ONLY the replacement code inside a markdown code block'));
  });

  it('extracts clean code block from model response', () => {
    const sampleResponse = `Here is the refactored code:\n\`\`\`typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n\`\`\`\nHope this helps!`;
    const extracted = extractCodeBlock(sampleResponse);
    assert.strictEqual(
      extracted,
      'function add(a: number, b: number): number {\n  return a + b;\n}'
    );
  });
});
