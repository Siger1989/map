import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
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

let realDatabaseId = 0;
const realCache = (factory, options = {}) => createBrowserTileCache({
  indexedDB: factory,
  databaseName: `shantu-browser-tile-cache-test-${++realDatabaseId}`,
  ...options,
});

async function waitForMiss(cache, key) {
  for (let i = 0; i < 100; i++) {
    if (await cache.get(key) === undefined) return;
    await tick();
  }
  assert.fail(`cache entry ${key} was not removed`);
}

function holdRealReadCallbacks(indexedDB, held) {
  const wrapRequest = (request, holdSuccess = false) => {
    let proxy;
    proxy = new Proxy(request, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, property, value) {
        if (holdSuccess && property === 'onsuccess') {
          target.onsuccess = event => held.push(() => value.call(proxy, event));
          return true;
        }
        return Reflect.set(target, property, value, target);
      },
    });
    return proxy;
  };
  const wrapStore = store => new Proxy(store, {
    get(target, property) {
      if (property === 'get') return key => wrapRequest(target.get(key), true);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const wrapDatabase = database => new Proxy(database, {
    get(target, property) {
      if (property === 'transaction') return (...args) => {
        const transaction = target.transaction(...args);
        return new Proxy(transaction, {
          get(tx, txProperty) {
            if (txProperty === 'objectStore') return name => wrapStore(tx.objectStore(name));
            const value = Reflect.get(tx, txProperty, tx);
            return typeof value === 'function' ? value.bind(tx) : value;
          },
          set(tx, txProperty, value) { return Reflect.set(tx, txProperty, value, tx); },
        });
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  });
  return {
    open(name, version) {
      let proxy;
      proxy = new Proxy(indexedDB.open(name, version), {
        get(target, property) {
          if (property === 'result') return target.result ? wrapDatabase(target.result) : target.result;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
          if (property === 'onsuccess') {
            target.onsuccess = event => value.call(proxy, event);
            return true;
          }
          return Reflect.set(target, property, value, target);
        },
      });
      return proxy;
    },
  };
}

async function waitForHeldCallbacks(held) {
  await until(() => held.length >= 2, 'real IndexedDB read callbacks were not held');
}

const releaseHeldCallbacks = held => { for (const release of held.splice(0)) release(); };

test('reopens the isolated database and returns an independent cached buffer', async () => {
  const indexedDB = new FakeIndexedDB();
  const firstCache = createBrowserTileCache({ indexedDB, memoryMaxBytes: 0 });
  const source = Uint8Array.of(1, 2, 3, 4).buffer;
  firstCache.put('sha256:a', source);
  new Uint8Array(source)[0] = 99;
  const firstHit = await waitForHit(firstCache, 'sha256:a');
  assert.deepEqual([...new Uint8Array(firstHit)], [1, 2, 3, 4]);
  firstCache.dispose();

  const secondCache = createBrowserTileCache({ indexedDB, memoryMaxBytes: 0 });
  const reopened = await waitForHit(secondCache, 'sha256:a');
  assert.deepEqual([...new Uint8Array(reopened)], [1, 2, 3, 4]);
  secondCache.dispose();
});

test('expires entries by TTL and honors the smaller per-entry server max-age', async () => {
  const indexedDB = new FakeIndexedDB();
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const cache = createBrowserTileCache({ indexedDB, ttlMs: 500, readTimeoutMs: 20, memoryMaxBytes: 0 });
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
  const bytesCache = createBrowserTileCache({ indexedDB, maxBytes: 5, maxEntries: 10, memoryMaxBytes: 0 });
  bytesCache.put('old', Uint8Array.of(1, 2, 3).buffer);
  await waitForHit(bytesCache, 'old');
  bytesCache.put('new', Uint8Array.of(4, 5, 6).buffer);
  await waitForHit(bytesCache, 'new');
  assert.equal(await bytesCache.get('old'), undefined);
  assert.deepEqual([...new Uint8Array(await bytesCache.get('new'))], [4, 5, 6]);
  bytesCache.dispose();

  const entryFactory = new FakeIndexedDB();
  const entryCache = createBrowserTileCache({ indexedDB: entryFactory, maxBytes: 64, maxEntries: 2, memoryMaxBytes: 0 });
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
  const cache = createBrowserTileCache({ indexedDB, readTimeoutMs: 5, memoryMaxBytes: 0 });
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
  const cache = createBrowserTileCache({ indexedDB, maxBytes: 32 * 1024 * 1024, maxEntries: 10, memoryMaxBytes: 0 });
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

test('memory cache returns an immediate independent hit before IndexedDB opens', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = `shantu-browser-tile-cache-real-${++realDatabaseId}`;
  const cache = createBrowserTileCache({ indexedDB, databaseName, maxBytes: 0, memoryMaxBytes: 64 });
  const source = Uint8Array.of(1, 2, 3).buffer;
  cache.put('sha256:memory-hit', source);
  new Uint8Array(source)[0] = 9;
  const first = await cache.get('sha256:memory-hit');
  assert.deepEqual([...new Uint8Array(first)], [1, 2, 3], 'memory hit is available before IndexedDB opens');
  new Uint8Array(first)[1] = 8;
  assert.deepEqual([...new Uint8Array(await cache.get('sha256:memory-hit'))], [1, 2, 3], 'callers cannot mutate the cached value');
  cache.dispose();
});

test('real IndexedDB hit promotion keeps the original provider TTL', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = `shantu-browser-tile-cache-real-${++realDatabaseId}`;
  const originalNow = Date.now;
  let now = 20_000;
  Date.now = () => now;
  const writer = createBrowserTileCache({ indexedDB, databaseName, ttlMs: 500, memoryMaxBytes: 0 });
  const idbReader = createBrowserTileCache({ indexedDB, databaseName, ttlMs: 500, memoryMaxBytes: 0 });
  const hotReader = createBrowserTileCache({ indexedDB, databaseName, ttlMs: 500, memoryMaxBytes: 64 });
  try {
    writer.put('sha256:short-lived', Uint8Array.of(7, 8).buffer, 40);
    await waitForHit(idbReader, 'sha256:short-lived');
    writer.dispose();
    idbReader.dispose();

    now += 30;
    assert.deepEqual([...new Uint8Array(await hotReader.get('sha256:short-lived'))], [7, 8], 'IDB hit is promoted to memory');
    now += 11;
    assert.equal(await hotReader.get('sha256:short-lived'), undefined, 'promotion does not restart the 40ms provider TTL');
  } finally {
    hotReader.dispose();
    Date.now = originalNow;
  }
});

test('memory cache uses byte-bounded LRU and supports a zero-byte disable switch', async () => {
  const indexedDB = new IDBFactory();
  const lru = realCache(indexedDB, { maxBytes: 0, memoryMaxBytes: 4 });
  lru.put('a', Uint8Array.of(1, 1).buffer);
  lru.put('b', Uint8Array.of(2, 2).buffer);
  await lru.get('a'); // Promote a to the newest position.
  lru.put('c', Uint8Array.of(3, 3).buffer);
  assert.ok(await lru.get('a'));
  assert.equal(await lru.get('b'), undefined, 'least-recently-used bytes are evicted first');
  assert.deepEqual([...new Uint8Array(await lru.get('c'))], [3, 3]);
  lru.dispose();

  const disabled = realCache(new IDBFactory(), { maxBytes: 0, memoryMaxBytes: 0 });
  disabled.put('disabled', Uint8Array.of(4).buffer);
  assert.equal(await disabled.get('disabled'), undefined, 'zero disables the memory layer');
  disabled.dispose();
});

test('forget removes memory and IndexedDB entries; dispose clears the hot layer only', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = `shantu-browser-tile-cache-real-${++realDatabaseId}`;
  const cache = createBrowserTileCache({ indexedDB, databaseName, memoryMaxBytes: 64 });
  const idbReader = createBrowserTileCache({ indexedDB, databaseName, memoryMaxBytes: 0 });
  cache.put('sha256:forget', Uint8Array.of(5, 6).buffer);
  await waitForHit(idbReader, 'sha256:forget');
  cache.forget('sha256:forget');
  assert.equal(await cache.get('sha256:forget'), undefined, 'forget drops the hot copy immediately');
  await waitForMiss(idbReader, 'sha256:forget');

  cache.put('sha256:preserve', Uint8Array.of(7).buffer);
  await waitForHit(idbReader, 'sha256:preserve');
  cache.dispose();
  cache.forget('sha256:preserve');
  assert.equal(await cache.get('sha256:preserve'), undefined, 'disposed cache cannot serve its former memory copy');
  assert.deepEqual([...new Uint8Array(await idbReader.get('sha256:preserve'))], [7], 'dispose leaves persistent cache data intact');
  idbReader.dispose();
});

test('in-flight real IndexedDB gets cannot revive data after forget, dispose, or put', async () => {
  for (const action of ['forget', 'dispose', 'put']) {
    const indexedDB = new IDBFactory();
    const databaseName = `shantu-browser-tile-cache-race-${action}-${++realDatabaseId}`;
    const writer = createBrowserTileCache({ indexedDB, databaseName, memoryMaxBytes: 0 });
    const observer = createBrowserTileCache({ indexedDB, databaseName, memoryMaxBytes: 0 });
    writer.put('sha256:race', Uint8Array.of(1, 2).buffer);
    await waitForHit(observer, 'sha256:race');
    writer.dispose();
    observer.dispose();

    const held = [];
    const cache = createBrowserTileCache({ indexedDB: holdRealReadCallbacks(indexedDB, held), databaseName, memoryMaxBytes: 64 });
    await tick(); await tick(); // Let the actual IDBOpenDBRequest complete before starting the held read.
    const pending = cache.get('sha256:race');
    await waitForHeldCallbacks(held);
    if (action === 'forget') cache.forget('sha256:race');
    else if (action === 'dispose') cache.dispose();
    else cache.put('sha256:race', Uint8Array.of(8, 9).buffer);
    assert.equal(await pending, undefined, `${action} settles the old read as a miss`);
    releaseHeldCallbacks(held);

    if (action === 'put') {
      assert.deepEqual([...new Uint8Array(await cache.get('sha256:race'))], [8, 9], 'late old read cannot replace the new hot value');
      cache.dispose();
    } else if (action === 'forget') {
      const forgetObserver = createBrowserTileCache({ indexedDB, databaseName, memoryMaxBytes: 0 });
      await waitForMiss(forgetObserver, 'sha256:race');
      forgetObserver.dispose();
    } else {
      const reopened = createBrowserTileCache({ indexedDB, databaseName, memoryMaxBytes: 0 });
      assert.deepEqual([...new Uint8Array(await waitForHit(reopened, 'sha256:race'))], [1, 2], 'dispose keeps the persistent entry available');
      reopened.dispose();
    }
  }
});
