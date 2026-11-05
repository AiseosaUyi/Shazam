import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shouldAutoApprove, proposeOrRun, normalizeApprovalMode, type ApprovalPolicy } from '../src/lib/cowork/approval';

const smart: ApprovalPolicy = { mode: 'smart', selfEmails: ['me@x.com', 'ME@work.io'] };

describe('approval policy', () => {
  it('ask never auto-runs, auto always does', () => {
    assert.strictEqual(shouldAutoApprove({ mode: 'ask', selfEmails: [] }, 'calendar_create', {}), false);
    assert.strictEqual(shouldAutoApprove({ mode: 'auto', selfEmails: [] }, 'gmail_send', { to: ['a@b.co'] }), true);
    assert.strictEqual(shouldAutoApprove(undefined, 'calendar_create', {}), false);
  });
  it('smart runs emails to yourself and asks for anyone else', () => {
    assert.strictEqual(shouldAutoApprove(smart, 'gmail_send', { to: ['me@x.com'] }), true);
    assert.strictEqual(shouldAutoApprove(smart, 'schedule_email', { to: ['me@work.io'], cc: ['ME@X.com'] }), true);
    assert.strictEqual(shouldAutoApprove(smart, 'gmail_send', { to: ['me@x.com', 'boss@corp.com'] }), false);
    assert.strictEqual(shouldAutoApprove(smart, 'gmail_send', { to: [] }), false);
  });
  it('smart runs solo calendar events and asks when inviting others', () => {
    assert.strictEqual(shouldAutoApprove(smart, 'calendar_create', { summary: 'focus' }), true);
    assert.strictEqual(shouldAutoApprove(smart, 'calendar_create', { attendees: ['me@x.com'] }), true);
    assert.strictEqual(shouldAutoApprove(smart, 'calendar_create', { attendees: ['sam@y.com'] }), false);
  });
  it('smart runs scheduled tasks unless the result is emailed to someone else; MCP mutations still ask', () => {
    assert.strictEqual(shouldAutoApprove(smart, 'schedule_task', { title: 't' }), true);
    assert.strictEqual(shouldAutoApprove(smart, 'schedule_task', { emailResultTo: 'sam@y.com' }), false);
    assert.strictEqual(shouldAutoApprove(smart, 'mcp_call', { tool: 'delete_row' }), false);
  });
  it('unknown modes fall back to smart', () => {
    assert.strictEqual(normalizeApprovalMode(undefined), 'smart');
    assert.strictEqual(normalizeApprovalMode('ask'), 'ask');
    assert.strictEqual(normalizeApprovalMode('nope'), 'smart');
  });
  it('proposeOrRun leaves non-auto actions pending and never executes them', async () => {
    const calls: string[] = [];
    const platform: any = {
      createPendingAction: async (_u: string, kind: string) => { calls.push('create'); return { id: 'a1', userId: 'u', kind, payload: {}, summary: 's', status: 'pending' }; },
      decidePendingAction: async () => { calls.push('decide'); return true; },
      completePendingAction: async () => { calls.push('complete'); },
    };
    const r = await proposeOrRun(platform, 'u', 'gmail_send', 's', { to: ['boss@corp.com'] }, smart);
    assert.strictEqual(r.auto, false);
    assert.deepStrictEqual(calls, ['create']);
  });
});
