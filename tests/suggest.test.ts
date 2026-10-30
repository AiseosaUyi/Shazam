import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestAgent, type SuggestContext } from '../src/lib/agents/suggest';

const ctx: SuggestContext = { googleConnected: false, githubConnected: false, desktopOnline: false, browserOnline: false, sandbox: true, mcpServers: ['DeepWiki'], hasOwnKey: false };

describe('Agent suggestion before running', () => {
  const cases: Array<[string, string]> = [
    ['Fix the failing unit test in src/auth.ts and push a PR', 'code'],
    ['Build a landing page in Next.js with pricing cards', 'code'],
    ['Schedule an email to sam@x.com for Monday 9am about the launch', 'cowork'],
    ['Summarize my unread emails and draft replies', 'cowork'],
    ['Create a 9:16 poster for our Friday party', 'image'],
    ['Cut the silences from this clip and add captions [Attached video: a.mp4](https://x/a.mp4)', 'video'],
    ['What is a vector database?', 'chat'],
  ];
  for (const [prompt, agent] of cases) {
    it(`routes "${prompt.slice(0, 40)}…" to ${agent}`, () => assert.equal(suggestAgent(prompt, ctx).agent, agent));
  }

  it('names what is missing instead of failing later', () => {
    const s = suggestAgent('Schedule an email to sam@x.com for Monday 9am', ctx);
    assert.ok(s.missing.some((m) => m.what.startsWith('Google')));
    const c = suggestAgent('Fix the bug and push to GitHub', ctx);
    assert.ok(c.missing.some((m) => m.what === 'GitHub'));
    assert.equal(suggestAgent('Fix the bug and push to GitHub', { ...ctx, githubConnected: true }).missing.length, 0);
  });
});
