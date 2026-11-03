import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream, tool } from 'ai';
import { z } from 'zod';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { RunsRepo } from '@/lib/runs/repo';
import { streamAgent, startMessages, RESUME_NOTE } from '@/lib/agent/stream';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
/** A model that always calls the `work` tool: a run that never finishes on its own. */
const toolCaller = () =>
  new MockLanguageModelV4({
    modelId: 'loop',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'tool-call', toolCallId: `c${Math.random()}`, toolName: 'work', input: '{}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ] as any[],
      }),
    }) as any,
  });
const tools = { work: tool({ description: 'do work', inputSchema: z.object({}), execute: async () => 'worked' }) };

async function setup() {
  const db = createTestDatabase();
  await new DbRepo(db).createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });
  return new RunsRepo(db);
}

describe('Long runs pause at a time limit and resume', () => {
  it('stops starting new steps after the deadline and reports paused with the conversation', async () => {
    const checkpoints: number[] = [];
    const out = await streamAgent({
      model: toolCaller() as any,
      instructions: 'x',
      messages: [{ role: 'user', content: 'do the task' }],
      tools,
      maxSteps: 40,
      deadline: Date.now() - 1,
      onCheckpoint: (m) => { checkpoints.push(m.length); },
    });
    assert.equal(out.paused, true);
    assert.equal(out.steps, 1);
    // user prompt + assistant tool call + tool result
    assert.equal(out.messages.length, 3);
    assert.deepEqual(checkpoints, [3]);
  });

  it('is not paused when the step budget (not the deadline) ends the run', async () => {
    const out = await streamAgent({ model: toolCaller() as any, instructions: 'x', messages: [{ role: 'user', content: 'go' }], tools, maxSteps: 2 });
    assert.equal(out.paused, false);
    assert.equal(out.steps, 2);
  });

  it('resumes from a checkpoint with a resume note instead of repeating the prompt', () => {
    const saved: any[] = [{ role: 'user', content: 'do the task' }, { role: 'assistant', content: 'working' }];
    const resumed = startMessages('do the task', [], saved);
    assert.equal(resumed.length, 3);
    assert.equal(resumed[2].content, RESUME_NOTE);
    assert.deepEqual(startMessages('hi', [{ role: 'assistant', content: 'earlier' }]).map((m) => m.content), ['earlier', 'hi']);
  });

  it('claims a paused run once, and never one whose owner is still alive', async () => {
    const runs = await setup();
    const a = await runs.create('u1', { agent: 'code', prompt: 'p' });
    await runs.update('u1', a.id, { status: 'paused' });
    const b = await runs.create('u1', { agent: 'code', prompt: 'q' });
    await runs.update('u1', b.id, { status: 'running' });
    await runs.setLease('u1', b.id, new Date(Date.now() + 600_000).toISOString());

    const first = await runs.claimResumable(840_000);
    assert.equal(first?.id, a.id);
    assert.equal(first?.status, 'running');
    assert.equal(first?.segment, 1);
    assert.equal(await runs.claimResumable(840_000), null, 'a claimed run and a live run are not claimed again');
  });

  it('resumes a run whose invocation died (lease expired)', async () => {
    const runs = await setup();
    const died = await runs.create('u1', { agent: 'code', prompt: 'p' });
    await runs.update('u1', died.id, { status: 'running' });
    await runs.setLease('u1', died.id, new Date(Date.now() - 1000).toISOString());
    assert.equal((await runs.claimResumable(840_000))?.id, died.id);
  });

  it('never restarts unowned or long-dead runs: they are marked failed instead', async () => {
    const runs = await setup();
    const noLease = await runs.create('u1', { agent: 'code', prompt: 'old work' });
    await runs.update('u1', noLease.id, { status: 'running' });
    assert.equal(await runs.expireAbandoned(20 * 60_000), 0, 'recently active: left alone');
    assert.equal(await runs.claimResumable(840_000), null, 'no lease: never claimed');
    assert.equal(await runs.expireAbandoned(-1), 1);
    const got = await runs.get('u1', noLease.id);
    assert.equal(got?.status, 'error');
    assert.match(got?.error || '', /stopped unexpectedly/);

    const longDead = await runs.create('u1', { agent: 'code', prompt: 'x' });
    await runs.update('u1', longDead.id, { status: 'paused' });
    await runs.setLease('u1', longDead.id, new Date(Date.now() - 3 * 3600_000).toISOString());
    assert.equal(await runs.claimResumable(840_000), null);
    assert.equal((await runs.get('u1', longDead.id))?.status, 'error');
  });

  it('keeps the checkpoint, options and segment across saves', async () => {
    const runs = await setup();
    const r = await runs.create('u1', { agent: 'code', prompt: 'p' });
    await runs.saveOptions('u1', r.id, { pinnedModel: 'local', stepsUsed: 12 });
    await runs.saveCheckpoint('u1', r.id, [{ role: 'user', content: 'p' }]);
    await runs.update('u1', r.id, { status: 'paused' });
    const got = await runs.get('u1', r.id);
    assert.deepEqual(got?.options, { pinnedModel: 'local', stepsUsed: 12 });
    assert.equal(got?.checkpoint?.length, 1);
    assert.equal(got?.status, 'paused');
  });
});
