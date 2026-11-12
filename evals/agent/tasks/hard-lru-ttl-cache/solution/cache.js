class Cache {
  constructor({ max, ttl = 0, now = Date.now, onEvict } = {}) {
    if (!Number.isInteger(max) || max < 1) throw new Error('max must be a positive integer');
    this.max = max;
    this.ttl = ttl;
    this.now = now;
    this.onEvict = onEvict;
    this.map = new Map(); // oldest -> newest
    this.pending = new Map();
    this._stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
  }

  _expiryFor(ttl) {
    const t = ttl === undefined ? this.ttl : ttl;
    return !t || t === Infinity ? Infinity : this.now() + t;
  }

  _isExpired(entry) {
    return this.now() >= entry.expires;
  }

  _expire(key, entry) {
    this.map.delete(key);
    this._stats.expirations++;
    if (this.onEvict) this.onEvict(key, entry.value, 'expired');
  }

  _purge() {
    for (const [key, entry] of [...this.map]) {
      if (this._isExpired(entry)) this._expire(key, entry);
    }
  }

  _touch(key, entry) {
    this.map.delete(key);
    this.map.set(key, entry);
  }

  set(key, value, { ttl } = {}) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: this._expiryFor(ttl) });
    if (this.map.size > this.max) {
      this._purge();
      while (this.map.size > this.max) {
        const [oldKey, oldEntry] = this.map.entries().next().value;
        this.map.delete(oldKey);
        this._stats.evictions++;
        if (this.onEvict) this.onEvict(oldKey, oldEntry.value, 'lru');
      }
    }
    return this;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) { this._stats.misses++; return undefined; }
    if (this._isExpired(entry)) { this._expire(key, entry); this._stats.misses++; return undefined; }
    this._touch(key, entry);
    this._stats.hits++;
    return entry.value;
  }

  peek(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) { this._expire(key, entry); return undefined; }
    return entry.value;
  }

  has(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (this._isExpired(entry)) { this._expire(key, entry); return false; }
    return true;
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (this._isExpired(entry)) { this._expire(key, entry); return false; }
    this.map.delete(key);
    return true;
  }

  clear() {
    this.map.clear();
  }

  get size() {
    this._purge();
    return this.map.size;
  }

  keys() {
    this._purge();
    return [...this.map.keys()].reverse();
  }

  stats() {
    return { ...this._stats, size: this.size };
  }

  getOrSet(key, loader, { ttl } = {}) {
    if (this.has(key)) return this.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    this._stats.misses++;
    let result;
    try {
      result = loader(key);
    } catch (e) {
      throw e;
    }
    if (result && typeof result.then === 'function') {
      const p = result.then(
        (v) => { this.pending.delete(key); this.set(key, v, { ttl }); return v; },
        (e) => { this.pending.delete(key); throw e; },
      );
      this.pending.set(key, p);
      return p;
    }
    this.set(key, result, { ttl });
    return result;
  }
}

module.exports = { Cache };
