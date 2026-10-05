import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserTileCache } from '../modules/mapSources/browserTileCache.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => value instanceof ArrayBuffer ? value.slice(0) : structuredClone(value);

class FakeRequest {
  result = undefined;
  error = undefined;
  onsuccess = null;
  onerror = null;
}

class FakeTransaction {
  oncomplete = null;
  onabort = null;
  onerror = null;
  error = undefined;
  pending = 0;
  ended = false;
  constructor(db, mode) { this.db = db; this.mode = mode; }
  objectStore(name) { return new FakeStore(this, this.db.stores.get(name)); }
  request(action) {
    const request = new FakeRequest();
    this.pending++;
    const perform = () => {
      if (this.ended) return;
      try {
        if (this.db.factory.failNextRequest) {
          this.db.factory.failNextRequest = false;
          throw Error('injected IndexedDB request failure');
        }
        request.result = action();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
        this.error = error;
        this.onabort?.();
        this.ended = true;
      }
      this.pending--;
      this.maybeComplete();
    };
    this.db.factory.schedule(perform);
    return request;
  }
  maybeComplete() {
    if (this.pending !== 0 || this.ended) return;
    this.db.factory.schedule(() => {
      if (this.pending === 0 && !this.ended) {
        this.ended = true;
        this.oncomplete?.();
      }
    });
  }
  abort() {
    if (this.ended) return;
    this.ended = true;
    this.error = Error('transaction aborted');
    this.onabort?.();
  }
}

class FakeStore {
  constructor(transaction, records) { this.transaction = transaction; this.records = records; }
  createIndex() {}
  get(key) { return this.transaction.request(() => clone(this.records.get(key))); }
  getAll() { return this.transaction.request(() => [...this.records.values()].map(clone)); }
  put(record) { return this.transaction.request(() => { this.records.set(record.key, clone(record)); return record.key; }); }
  delete(key) { return this.transaction.request(() => this.records.delete(key)); }
}

class FakeDatabase {
  constructor(factory) {
    this.factory = factory;
    this.stores = new Map();
    this.objectStoreNames = { contains: name => this.stores.has(name) };
  }
  createObjectStore(name) {
    const records = new Map();
    this.stores.set(name, records);
    return new FakeStore(new FakeTransaction(this, 'versionchange'), records);
  }
  transaction(_names, mode) {
    this.factory.transactionCount++;
    return new FakeTransaction(this, mode);
  }
  close() { this.closed = true; }
}

class FakeIndexedDB {
  databases = new Map();
  failNextRequest = false;
  transactionCount = 0;
  paused = false;
  scheduled = [];
  schedule(task) {
    if (this.paused) this.scheduled.push(task);
    else setImmediate(task);
  }
  resume() {
    this.paused = false;
    const pending = this.scheduled.splice(0);
    for (const task of pending) setImmediate(task);
  }
  open(name) {
    const request = { result: undefined, error: undefined, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    setImmediate(() => {
      if (!this.databases.has(name)) {
        const database = new FakeDatabase(this);
        this.databases.set(name, database);
        request.result = database;
        request.onupgradeneeded?.();
      } else request.result = this.databases.get(name);
      request.onsuccess?.();
    });
    return request;
  }
}

async function until(predicate, message = 'condition did not settle') {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

async function waitForHit(cache, key) {
  let result;
  for (let i = 0; i < 100; i++) {
    result = await cache.get(key);
    if (result) return result;
    await tick();
  }
  assert.fail(`cache entry ${key} was not written`);
}

test('reopens the isolated database and returns an independent cached buffer', async () => {
  const indexedDB = new FakeIndexedDB();
  const firstCache = createBrowserTileCache({ indexedDB });
  const source = Uint8Array.of(1, 2, 3, 4).buffer;
  firstCache.put('sha256:a', source);
  new Uint8Array(source)[0] = 99;
  const firstHit = await waitForHit(firstCache, 'sha256:a');
  assert.deepEqual([...new Uint8Array(firstHit)], [1, 2, 3, 4]);
  firstCache.dispose();

  const secondCache = createBrowserTileCache({ indexedDB });
  const reopened = await waitForHit(secondCache, 'sha256:a');
  assert.deepEqual([...new Uint8Array(reopened)], [1, 2, 3, 4]);
  secondCache.dispose();
});

test('expires entries by TTL and honors the smaller per-entry server max-age', async () => {
  const indexedDB = new FakeIndexedDB();
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const cache = createBrowserTileCache({ indexedDB, ttlMs: 500, readTimeoutMs: 20 });
  try {
    cache.put('short', Uint8Array.of(1).buffer, 40);
    await waitForHit(cache, 'short');
    now += 41;
    assert.equal(await cache.get('short'), undefined);
  } finally {
    cache.dispose();
    Date.now = originalNow;
  }
});

test('evicts oldest entries to satisfy byte and entry budgets', async () => {
  const indexedDB = new FakeIndexedDB();
  const bytesCache = createBrowserTileCache({ indexedDB, maxBytes: 5, maxEntries: 10 });
  bytesCache.put('old', Uint8Array.of(1, 2, 3).buffer);
  await waitForHit(bytesCache, 'old');
  bytesCache.put('new', Uint8Array.of(4, 5, 6).buffer);
  await waitForHit(bytesCache, 'new');
  assert.equal(await bytesCache.get('old'), undefined);
  assert.deepEqual([...new Uint8Array(await bytesCache.get('new'))], [4, 5, 6]);
  bytesCache.dispose();

  const entryFactory = new FakeIndexedDB();
  const entryCache = createBrowserTileCache({ indexedDB: entryFactory, maxBytes: 64, maxEntries: 2 });
  for (const key of ['a', 'b', 'c']) {
    entryCache.put(key, Uint8Array.of(key.charCodeAt(0)).buffer);
    await waitForHit(entryCache, key);
  }
  assert.equal(await entryCache.get('a'), undefined);
  assert.ok(await entryCache.get('b'));
  assert.ok(await entryCache.get('c'));
  entryCache.dispose();
});

test('read failures and timed-out reads become misses without throwing', async () => {
  const indexedDB = new FakeIndexedDB();
  const cache = createBrowserTileCache({ indexedDB, readTimeoutMs: 5 });
  cache.put('present', Uint8Array.of(9).buffer);
  await waitForHit(cache, 'present');
  indexedDB.failNextRequest = true;
  assert.equal(await cache.get('present'), undefined);

  indexedDB.paused = true;
  const started = Date.now();
  assert.equal(await cache.get('present'), undefined);
  assert.ok(Date.now() - started < 100, 'read timeout returns promptly');
  indexedDB.resume();
  cache.dispose();
});

test('background write queue is bounded by 16MiB including the active write', async () => {
  const indexedDB = new FakeIndexedDB();
  const cache = createBrowserTileCache({ indexedDB, maxBytes: 32 * 1024 * 1024, maxEntries: 10 });
  indexedDB.paused = true;
  const large = new ArrayBuffer(8 * 1024 * 1024);
  cache.put('active', large);
  await until(() => indexedDB.transactionCount > 0, 'first write did not enter IndexedDB');
  cache.put('queued', large);
  cache.put('over-limit', Uint8Array.of(1).buffer);
  indexedDB.resume();
  await waitForHit(cache, 'queued');
  assert.equal(await cache.get('over-limit'), undefined, 'write above queue byte limit is dropped');
  assert.ok(await cache.get('active'));
  cache.dispose();
});
