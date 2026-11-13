class Scheduler {
  constructor({ concurrency = Infinity } = {}) {
    this.concurrency = concurrency;
  }

  add(id, fn, options = {}) {
    throw new Error('not implemented');
  }

  async run() {
    throw new Error('not implemented');
  }
}

module.exports = { Scheduler };
