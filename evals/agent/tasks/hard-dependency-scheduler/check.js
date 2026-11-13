const assert = require('node:assert/strict');
const path = require('path');
const { Scheduler } = require(path.join(process.cwd(), 'scheduler.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Results flow through ctx and order is by start.
  {
    const s = new Scheduler();
    s.add('a', async () => 1).add('b', async ({ results }) => results.a + 1, { deps: ['a'] }).add('c', async ({ results }) => results.a + results.b, { deps: ['a', 'b'] });
    const r = await s.run();
    assert.deepEqual(r.results, { a: 1, b: 2, c: 3 });
    assert.deepEqual(r.order, ['a', 'b', 'c']);
    assert.deepEqual(r.errors, {});
    assert.deepEqual(r.skipped, []);
    assert.deepEqual(r.attempts, { a: 1, b: 1, c: 1 });
  }
  // Concurrency limit is respected and fully used; insertion order among ready tasks.
  {
    const s = new Scheduler({ concurrency: 2 });
    let now = 0, peak = 0;
    const started = [];
    for (const id of ['t1', 't2', 't3', 't4', 't5']) {
      s.add(id, async () => { started.push(id); now++; peak = Math.max(peak, now); await sleep(20); now--; return id; });
    }
    const r = await s.run();
    assert.equal(peak, 2);
    assert.deepEqual(started, ['t1', 't2', 't3', 't4', 't5']);
    assert.deepEqual(r.order, started);
  }
  // A freed slot starts the next ready task immediately, not at the next "wave".
  {
    const s = new Scheduler({ concurrency: 2 });
    const t0 = Date.now();
    const at = {};
    s.add('slow', async () => { await sleep(120); });
    s.add('fast1', async () => { await sleep(20); });
    s.add('fast2', async () => { at.fast2 = Date.now() - t0; await sleep(20); });
    await s.run();
    assert.ok(at.fast2 < 80, `fast2 should start when fast1 frees its slot (started at ${at.fast2}ms)`);
  }
  // Retries stay in the slot, count attempts, and eventually succeed.
  {
    const s = new Scheduler({ concurrency: 1 });
    let calls = 0;
    const log = [];
    s.add('flaky', async () => { calls++; log.push('flaky' + calls); if (calls < 3) throw new Error('nope'); return 'ok'; }, { retries: 2 });
    s.add('other', async () => { log.push('other'); });
    const r = await s.run();
    assert.deepEqual(r.attempts, { flaky: 3, other: 1 });
    assert.equal(r.results.flaky, 'ok');
    assert.deepEqual(log, ['flaky1', 'flaky2', 'flaky3', 'other'], 'retries do not release the slot');
  }
  // Permanent failure: last error recorded, dependants skipped transitively, independents run.
  {
    const s = new Scheduler({ concurrency: 3 });
    let calls = 0;
    s.add('ok1', async () => 'x');
    s.add('bad', async () => { calls++; throw new Error('boom' + calls); }, { retries: 1 });
    s.add('child', async () => 'never', { deps: ['bad'] });
    s.add('grandchild', async () => 'never', { deps: ['child', 'ok1'] });
    s.add('ok2', async ({ results }) => results.ok1 + 'y', { deps: ['ok1'] });
    const r = await s.run();
    assert.equal(calls, 2);
    assert.equal(r.errors.bad.message, 'boom2');
    assert.deepEqual(r.skipped, ['child', 'grandchild']);
    assert.deepEqual(r.results, { ok1: 'x', ok2: 'xy' });
    assert.equal(r.attempts.child, undefined);
    assert.ok(!r.order.includes('child'));
  }
  // Synchronous throw is handled like a rejection.
  {
    const s = new Scheduler();
    s.add('sync', () => { throw new Error('sync boom'); });
    s.add('after', async () => 1, { deps: ['sync'] });
    const r = await s.run();
    assert.equal(r.errors.sync.message, 'sync boom');
    assert.deepEqual(r.skipped, ['after']);
  }
  // Validation happens before anything starts.
  {
    const s = new Scheduler();
    let started = false;
    s.add('a', async () => { started = true; });
    s.add('b', async () => {}, { deps: ['ghost'] });
    await assert.rejects(s.run(), (e) => e.message === 'Unknown dependency: ghost (required by b)');
    assert.equal(started, false);
  }
  {
    const s = new Scheduler();
    let started = false;
    s.add('ok', async () => { started = true; });
    s.add('a', async () => {}, { deps: ['b'] });
    s.add('b', async () => {}, { deps: ['c'] });
    s.add('c', async () => {}, { deps: ['a'] });
    await assert.rejects(s.run(), (e) => /^Cycle detected: /.test(e.message) && ['a', 'b', 'c'].every((id) => e.message.includes(id)) && !e.message.includes('ok') && e.message.split(' -> ').length >= 4);
    assert.equal(started, false);
    const self = new Scheduler();
    self.add('x', async () => {}, { deps: ['x'] });
    await assert.rejects(self.run(), /^Error: Cycle detected: x -> x$/);
  }
  assert.throws(() => new Scheduler().add('a', async () => {}).add('a', async () => {}), (e) => e.message === 'Duplicate task: a');
  // Empty, and run() twice.
  {
    const r = await new Scheduler().run();
    assert.deepEqual(r, { results: {}, errors: {}, order: [], skipped: [], attempts: {} });
    const s = new Scheduler();
    let n = 0;
    s.add('a', async () => ++n);
    const r1 = await s.run();
    const r2 = await s.run();
    assert.equal(r1.results.a, 1);
    assert.equal(r2.results.a, 2);
    assert.deepEqual(r2.order, ['a']);
  }
  // Wider graph: diamond with concurrency 2 keeps dependency order.
  {
    const s = new Scheduler({ concurrency: 2 });
    const done = [];
    const mk = (id, ms) => async () => { await sleep(ms); done.push(id); return id; };
    s.add('root', mk('root', 10)).add('l', mk('l', 30), { deps: ['root'] }).add('r', mk('r', 10), { deps: ['root'] }).add('join', mk('join', 5), { deps: ['l', 'r'] });
    const res = await s.run();
    assert.deepEqual(done, ['root', 'r', 'l', 'join']);
    assert.deepEqual(res.order, ['root', 'l', 'r', 'join']);
  }
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
