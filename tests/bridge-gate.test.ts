import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wantsLocalMachine } from '../src/lib/bridge/tools';

describe('cloud runs only get computer tools when the request is about the computer', () => {
  const no = [
    'Build a single-page landing page for Gruve with a pricing table and FAQ',
    'Fix the failing unit test in src/auth.ts and run the tests',
    'Write a debounce utility with tests',
  ];
  const yes = [
    'Push my changes to GitHub on a feature branch',
    'Run the tests on my Mac and commit the result',
    'Open the page in my browser and click Sign in',
    'Edit the files in ~/Desktop/Development/Gruve',
    'Deploy this to Vercel',
    'Create a pull request for this fix',
  ];
  for (const p of no) it(`stays in the cloud: "${p.slice(0, 48)}"`, () => assert.equal(wantsLocalMachine(p), false));
  for (const p of yes) it(`offers computer tools: "${p.slice(0, 48)}"`, () => assert.equal(wantsLocalMachine(p), true));
});
