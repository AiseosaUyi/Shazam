class Scheduler {
  constructor({ concurrency = Infinity } = {}) {
    this.concurrency = concurrency;
    this.tasks = new Map();
  }

  add(id, fn, { deps = [], retries = 0 } = {}) {
    if (this.tasks.has(id)) throw new Error(`Duplicate task: ${id}`);
    this.tasks.set(id, { id, fn, deps: [...deps], retries });
    return this;
  }

  validate() {
    const tasks = [...this.tasks.values()];
    for (const t of tasks) {
      for (const d of t.deps) {
        if (!this.tasks.has(d)) throw new Error(`Unknown dependency: ${d} (required by ${t.id})`);
      }
    }
    const state = new Map();
    const visit = (id, path) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) {
        const cycle = path.slice(path.indexOf(id)).concat(id);
        throw new Error(`Cycle detected: ${cycle.join(' -> ')}`);
      }
      state.set(id, 1);
      for (const d of this.tasks.get(id).deps) visit(d, [...path, id]);
      state.set(id, 2);
    };
    for (const t of tasks) visit(t.id, []);
  }

  async run() {
    this.validate();
    const tasks = [...this.tasks.values()];
    const results = {};
    const errors = {};
    const attempts = {};
    const order = [];
    const skipped = new Set();
    const done = new Set();
    const running = new Set();
    const finished = new Set();

    return new Promise((resolve) => {
      const settle = () => {
        if (finished.size === tasks.length) {
          resolve({ results, errors, order, skipped: tasks.filter((t) => skipped.has(t.id)).map((t) => t.id), attempts });
        }
      };
      const pump = () => {
        let changed = true;
        while (changed) {
          changed = false;
          for (const t of tasks) {
            if (finished.has(t.id) || running.has(t.id)) continue;
            if (t.deps.some((d) => d in errors || skipped.has(d))) {
              skipped.add(t.id);
              finished.add(t.id);
              changed = true;
            }
          }
        }
        for (const t of tasks) {
          if (running.size >= this.concurrency) break;
          if (finished.has(t.id) || running.has(t.id)) continue;
          if (!t.deps.every((d) => done.has(d))) continue;
          running.add(t.id);
          order.push(t.id);
          start(t);
        }
        settle();
      };
      const start = async (t) => {
        await null; // never run user code re-entrantly inside pump()
        let ok = false;
        let last;
        for (let a = 0; a <= t.retries && !ok; a++) {
          attempts[t.id] = a + 1;
          try {
            const ctx = { results: Object.fromEntries(t.deps.map((d) => [d, results[d]])) };
            results[t.id] = await t.fn(ctx);
            ok = true;
          } catch (e) {
            last = e;
          }
        }
        running.delete(t.id);
        finished.add(t.id);
        if (ok) done.add(t.id);
        else errors[t.id] = last;
        pump();
      };
      pump();
    });
  }
}

module.exports = { Scheduler };
