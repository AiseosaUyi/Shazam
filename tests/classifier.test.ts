import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyPrompt } from '@/lib/routing/classifier';

describe('Prompt Classifier & TaskSpec Tests', () => {
  it('classifies coding requests and flags tools capability', () => {
    const spec = classifyPrompt('Implement a debounce function in TypeScript with unit tests');
    assert.strictEqual(spec.taskClass, 'coding');
    assert.ok(spec.requiredCapabilities.includes('tools'));
  });

  it('classifies math and proof requests as reasoning', () => {
    const spec = classifyPrompt('Prove that the square root of 2 is irrational');
    assert.strictEqual(spec.taskClass, 'reasoning');
    assert.ok(spec.requiredCapabilities.includes('reasoning'));
  });

  it('classifies planning requests', () => {
    const spec = classifyPrompt('Create a migration roadmap and step-by-step rollout strategy for our database');
    assert.strictEqual(spec.taskClass, 'planning');
  });

  it('classifies image generation requests and sets image output modality', () => {
    const spec = classifyPrompt('Generate an image of a cybernetic eagle soaring through an aurora borealis');
    assert.strictEqual(spec.taskClass, 'image_generation');
    assert.strictEqual(spec.outputModality, 'image');
  });

  it('respects manual taskClass override', () => {
    const spec = classifyPrompt('Help me with this', 'writing');
    assert.strictEqual(spec.taskClass, 'writing');
    assert.strictEqual(spec.classifierConfidence, 'user_override');
  });
});
