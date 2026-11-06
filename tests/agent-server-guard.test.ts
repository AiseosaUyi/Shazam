import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startsServer } from '../src/lib/agent/tool_agent';

describe('run_command refuses long-running servers', () => {
  for (const c of ['python3 -m http.server 8000 &', 'npm run dev', 'npm start', 'next dev -p 3000', 'npx serve .', 'vite', 'yarn dev', 'pnpm run dev --port 3000', 'nodemon app.js'])
    it(`blocks: ${c}`, () => assert.equal(startsServer(c), true));
  for (const c of ['npm install', 'npm test', 'npm run build', 'npm run dev:build', 'npx tsc --noEmit', 'node --test', 'git status', 'ls -la', 'cat index.html | grep serve'])
    it(`allows: ${c}`, () => assert.equal(startsServer(c), false));
});
