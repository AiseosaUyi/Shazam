const assert = require('node:assert/strict');
const path = require('path');
const { Cache } = require(path.join(process.cwd(), 'cache.js'));
const clock = () => { let t = 1000; const f = () => t; f.tick = (ms) => { t += ms; }; return f; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  assert.throws(() => new Cache({ max: 0 }), /max must be a positive integer/);
  assert.throws(() => new Cache({}), /max must be a positive integer/);
  assert.throws(() => new Cache({ max: 1.5 }), /max must be a positive integer/);

  // LRU basics and recency by get.
  {
    const evicted = [];
    const c = new Cache({ max: 3, onEvict: (k, v, r) => evicted.push([k, v, r]) });
    c.set('a', 1).set('b', 2).set('c', 3);
    assert.equal(c.get('a'), 1);
    c.set('d', 4);
    assert.deepEqual(evicted, [['b', 2, 'lru']]);
    assert.deepEqual(c.keys(), ['d', 'a', 'c']);
    assert.equal(c.get('b'), undefined);
    assert.deepEqual(c.stats(), { hits: 1, misses: 1, evictions: 1, expirations: 0, size: 3 });
  }
  // peek and has do not change recency or stats.
  {
    const c = new Cache({ max: 2 });
    c.set('a', 1).set('b', 2);
    assert.equal(c.peek('a'), 1);
    assert.equal(c.has('a'), true);
    c.set('c', 3);
    assert.deepEqual(c.keys(), ['c', 'b'], 'a was still the least recently used');
    assert.deepEqual(c.stats(), { hits: 0, misses: 0, evictions: 1, expirations: 0, size: 2 });
  }
  // Overwrite: no eviction, no callback, becomes most recent.
  {
    const ev = [];
    const c = new Cache({ max: 2, onEvict: (...a) => ev.push(a) });
    c.set('a', 1).set('b', 2).set('a', 10);
    assert.deepEqual(c.keys(), ['a', 'b']);
    assert.equal(c.get('a'), 10);
    assert.deepEqual(ev, []);
    assert.equal(c.stats().evictions, 0);
  }
  // TTL expiry with a fake clock; boundary now >= expiry.
  {
    const now = clock();
    const ev = [];
    const c = new Cache({ max: 5, ttl: 100, now, onEvict: (k, v, r) => ev.push([k, r]) });
    c.set('a', 1).set('b', 2, { ttl: 500 }).set('c', 3, { ttl: 0 });
    now.tick(99);
    assert.equal(c.get('a'), 1);
    now.tick(1);
    assert.equal(c.get('a'), undefined, 'expires exactly at ttl');
    assert.deepEqual(ev, [['a', 'expired']]);
    assert.equal(c.stats().expirations, 1);
    assert.equal(c.stats().misses, 1);
    now.tick(10_000);
    assert.equal(c.get('c'), 3, 'ttl 0 per call means never');
    assert.equal(c.has('b'), false);
    assert.deepEqual(ev, [['a', 'expired'], ['b', 'expired']]);
    assert.deepEqual(c.keys(), ['c']);
  }
  // Capacity pressure purges expired entries before evicting live ones.
  {
    const now = clock();
    const ev = [];
    const c = new Cache({ max: 3, now, onEvict: (k, v, r) => ev.push([k, r]) });
    c.set('old', 1, { ttl: 10 }).set('b', 2).set('c', 3);
    now.tick(50);
    c.set('d', 4);
    assert.deepEqual(ev, [['old', 'expired']], 'no live entry was evicted');
    assert.deepEqual(c.keys(), ['d', 'c', 'b']);
    assert.equal(c.stats().evictions, 0);
    assert.equal(c.stats().expirations, 1);
  }
  // size, delete, clear semantics.
  {
    const now = clock();
    const c = new Cache({ max: 5, ttl: 10, now });
    c.set('a', 1).set('b', 2, { ttl: 100 });
    assert.equal(c.size, 2);
    now.tick(20);
    assert.equal(c.size, 1);
    assert.equal(c.delete('b'), true);
    assert.equal(c.delete('b'), false);
    c.set('x', 1);
    now.tick(20);
    assert.equal(c.delete('x'), false, 'expired entry is not "removed"');
    assert.equal(c.stats().expirations, 2, 'a (via size) and x (via delete)');
    c.set('y', 1);
    c.clear();
    assert.equal(c.size, 0);
    assert.equal(c.stats().expirations, 2, 'clear keeps stats');
  }
  // Map key semantics.
  {
    const c = new Cache({ max: 5 });
    c.set(NaN, 'nan').set(1, 'num').set('1', 'str');
    assert.equal(c.get(NaN), 'nan');
    assert.equal(c.get(1), 'num');
    assert.equal(c.get('1'), 'str');
  }
  // getOrSet sync.
  {
    const c = new Cache({ max: 5 });
    let calls = 0;
    assert.equal(c.getOrSet('k', () => ++calls), 1);
    assert.equal(c.getOrSet('k', () => ++calls), 1);
    assert.equal(calls, 1);
    assert.deepEqual(c.stats(), { hits: 1, misses: 1, evictions: 0, expirations: 0, size: 1 });
  }
  // getOrSet async: shared pending promise, rejection not cached.
  {
    const c = new Cache({ max: 5 });
    let calls = 0;
    const loader = async () => { calls++; await sleep(20); return 'v'; };
    const [p1, p2, p3] = [c.getOrSet('k', loader), c.getOrSet('k', loader), c.getOrSet('k', loader)];
    assert.equal(p1, p2);
    assert.deepEqual(await Promise.all([p1, p2, p3]), ['v', 'v', 'v']);
    assert.equal(calls, 1);
    assert.equal(c.stats().misses, 1);
    assert.equal(c.get('k'), 'v');
    let tries = 0;
    const bad = async () => { tries++; await sleep(5); throw new Error('load failed'); };
    await assert.rejects(c.getOrSet('z', bad), /load failed/);
    assert.equal(c.has('z'), false);
    await assert.rejects(c.getOrSet('z', bad), /load failed/);
    assert.equal(tries, 2, 'pending entry was cleared after the failure');
    const ok = await c.getOrSet('z', async () => 'fine');
    assert.equal(ok, 'fine');
  }
  // Expired entry in getOrSet reloads.
  {
    const now = clock();
    const c = new Cache({ max: 2, ttl: 10, now });
    let n = 0;
    assert.equal(c.getOrSet('k', () => ++n), 1);
    now.tick(10);
    assert.equal(c.getOrSet('k', () => ++n), 2);
  }
  // Eviction order stays correct under a longer random-ish workload, checked against a simple model.
  {
    const c = new Cache({ max: 4 });
    const model = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 500; i++) {
      const k = 'k' + Math.floor(rnd() * 9);
      if (rnd() < 0.5) {
        c.set(k, i);
        const at = model.indexOf(k); if (at >= 0) model.splice(at, 1);
        model.unshift(k);
        if (model.length > 4) model.pop();
      } else {
        const got = c.get(k);
        const at = model.indexOf(k);
        assert.equal(got !== undefined, at >= 0, 'step ' + i);
        if (at >= 0) { model.splice(at, 1); model.unshift(k); }
      }
      assert.deepEqual(c.keys(), model, 'step ' + i);
    }
  }
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
