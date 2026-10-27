const { describe, it } = require('node:test');
const assert = require('node:assert');

// In modern Next.js/TS, we can import or require compiled/direct modules
// Let's create a pure JS or TS runner or test file
const { classifyTask } = require('../../src/lib/routing/classifier.ts');

describe('Task Classifier Unit Tests', () => {
  it('correctly classifies coding tasks', () => {
    const spec = classifyTask('Write a Python function with unit tests to parse CSV files');
    assert.strictEqual(spec.taskClass, 'coding');
    assert.strictEqual(spec.outputModality, 'code');
    assert.ok(spec.requiredCapabilities.includes('code'));
  });

  it('correctly classifies deep reasoning tasks', () => {
    const spec = classifyTask('Step-by-step mathematical proof of why the square root of 2 is irrational');
    assert.strictEqual(spec.taskClass, 'reasoning');
    assert.ok(spec.requiredCapabilities.includes('reasoning'));
  });

  it('correctly classifies planning tasks', () => {
    const spec = classifyTask('Create a 6-month product roadmap and architecture migration plan');
    assert.strictEqual(spec.taskClass, 'planning');
  });

  it('correctly classifies writing tasks', () => {
    const spec = classifyTask('Draft a compelling executive email announcing the platform launch');
    assert.strictEqual(spec.taskClass, 'writing');
  });

  it('detects image attachments and classifies as vision', () => {
    const attachments = [{ id: '1', name: 'chart.png', mimeType: 'image/png', sizeBytes: 1024 }];
    const spec = classifyTask('Explain what is shown in this chart', attachments);
    assert.strictEqual(spec.taskClass, 'vision');
    assert.ok(spec.inputModalities.includes('image'));
  });

  it('preserves user cost policy override', () => {
    const spec = classifyTask('Hello world', [], undefined, 'free_only');
    assert.strictEqual(spec.costPolicy, 'free_only');
  });
});
