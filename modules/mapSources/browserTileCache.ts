type CacheOptions = {
  databaseName?: string;
  maxBytes?: number;
  maxEntries?: number;
  ttlMs?: number;
  readTimeoutMs?: number;
  memoryMaxBytes?: number;
  indexedDB?: IDBFactory;
};

type Metadata = { key: string; size: number; time: number; ttlMs: number };
type MemoryEntry = { value: ArrayBuffer; expiresAt: number };
type ReadTicket = { key: string; invalidated: boolean; invalidate: () => void };
type WriteOperation = { kind: 'put'; key: string; value: ArrayBuffer; size: number; time: number; ttlMs: number } | { kind: 'forget'; key: string };

const DEFAULT_DATABASE = 'shantu-browser-tile-cache-v1';
const DATABASE_VERSION = 1;
const TILES = 'tiles';
const METADATA = 'metadata';
const MAX_TILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MEMORY_MAX_BYTES = 16 * 1024 * 1024;
const MAX_MEMORY_ENTRIES = 512;
const MAX_ACTIVE_READS = 128;
const MAX_QUEUED_OPERATIONS = 16;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? Error('瓦片缓存事务失败'));
  });
}

/** Small best-effort browser cache, isolated from map-source and offline databases. */
export function createBrowserTileCache(options: CacheOptions = {}) {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 4096;
  const ttlMs = options.ttlMs ?? 300_000;
  const readTimeoutMs = options.readTimeoutMs ?? 20;
  const memoryMaxBytes = options.memoryMaxBytes ?? DEFAULT_MEMORY_MAX_BYTES;
  const databaseName = options.databaseName ?? DEFAULT_DATABASE;
  const factory = options.indexedDB ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);

  if (!databaseName || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0 ||
      !Number.isFinite(ttlMs) || ttlMs < 0 || !Number.isFinite(readTimeoutMs) || readTimeoutMs < 0 ||
      !Number.isSafeInteger(memoryMaxBytes) || memoryMaxBytes < 0)
    throw new RangeError('浏览瓦片缓存限制无效');

  let database: IDBDatabase | undefined;
  let disposed = false;
  const memory = new Map<string, MemoryEntry>();
  const activeReads = new Set<ReadTicket>();
  let memoryBytes = 0;
  let queue: WriteOperation[] = [];
  let queuedBytes = 0;
  let inFlightBytes = 0;
  let writing = false;
  let activeOperation: WriteOperation | undefined;
  let opening: Promise<IDBDatabase | undefined> | undefined;

  const invalidateReads = (key?: string) => {
    for (const ticket of [...activeReads]) {
      if (key === undefined || ticket.key === key) ticket.invalidate();
    }
  };

  const forgetPending = (key: string) =>
    (activeOperation?.kind === 'forget' && activeOperation.key === key) ||
    queue.some(operation => operation.kind === 'forget' && operation.key === key);

  const dropMemory = (key: string) => {
    const entry = memory.get(key);
    if (!entry) return;
    memory.delete(key);
    memoryBytes -= entry.value.byteLength;
  };

  const rememberMemory = (key: string, value: ArrayBuffer, expiresAt: number, copyValue = true) => {
    const size = value.byteLength;
    // Check every bound before copying; an item that cannot fit never allocates a hot-cache copy.
    if (disposed || !key || memoryMaxBytes === 0 || size === 0 || size > MAX_TILE_BYTES || size > memoryMaxBytes ||
        expiresAt < Date.now()) return;
    dropMemory(key);
    while (memory.size >= MAX_MEMORY_ENTRIES || memoryBytes + size > memoryMaxBytes) {
      const oldest = memory.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      dropMemory(oldest);
    }
    const copy = copyValue ? value.slice(0) : value;
    memory.set(key, { value: copy, expiresAt });
    memoryBytes += copy.byteLength;
  };

  const getMemory = (key: string): ArrayBuffer | undefined => {
    const entry = memory.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.expiresAt > 0) {
      dropMemory(key);
      return undefined;
    }
    memory.delete(key);
    memory.set(key, entry);
    try { return entry.value.slice(0); } catch { return undefined; }
  };

  const ensureOpen = (): Promise<IDBDatabase | undefined> => {
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    if (!factory || disposed) return Promise.resolve(undefined);
    opening = new Promise<IDBDatabase | undefined>(resolve => {
      let request: IDBOpenDBRequest;
      try { request = factory.open(databaseName, DATABASE_VERSION); }
      catch { resolve(undefined); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TILES)) db.createObjectStore(TILES, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(METADATA)) {
          const store = db.createObjectStore(METADATA, { keyPath: 'key' });
          store.createIndex('size', 'size');
          store.createIndex('time', 'time');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (disposed) db.close();
        else database = db;
        resolve(disposed ? undefined : db);
      };
      request.onerror = request.onblocked = () => resolve(undefined);
    }).finally(() => { opening = undefined; });
    return opening;
  };

  const runOperation = (db: IDBDatabase, operation: WriteOperation): Promise<void> => new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = db.transaction([TILES, METADATA], 'readwrite'); }
    catch (error) { reject(error); return; }
    const tiles = transaction.objectStore(TILES);
    const metadata = transaction.objectStore(METADATA);
    const done = transactionResult(transaction);
    if (operation.kind === 'forget') {
      tiles.delete(operation.key);
      metadata.delete(operation.key);
    } else {
      const all = metadata.getAll();
      all.onsuccess = () => {
        const entries = (all.result as Metadata[]).filter(entry => entry.key !== operation.key);
        entries.push({ key: operation.key, size: operation.size, time: operation.time, ttlMs: operation.ttlMs });
        let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
        let count = entries.length;
        entries.sort((a, b) => a.time - b.time);
        const evicted = new Set<string>();
        while (count > maxEntries || totalBytes > maxBytes) {
          const oldest = entries.shift();
          if (!oldest) break;
          evicted.add(oldest.key);
          totalBytes -= oldest.size;
          count--;
        }
        for (const key of evicted) {
          tiles.delete(key);
          metadata.delete(key);
        }
        if (!evicted.has(operation.key)) {
          tiles.put({ key: operation.key, value: operation.value });
          metadata.put({ key: operation.key, size: operation.size, time: operation.time, ttlMs: operation.ttlMs });
        }
      };
    }
    done.then(resolve, reject);
  });

  const pump = async () => {
    if (writing || disposed || queue.length === 0) return;
    writing = true;
    try {
      const db = await ensureOpen();
      if (!db || disposed) { queue = []; queuedBytes = 0; return; }
      while (!disposed && queue.length) {
        const operation = queue.shift()!;
        activeOperation = operation;
        if (operation.kind === 'put') { queuedBytes -= operation.size; inFlightBytes += operation.size; }
        try { await runOperation(db, operation); } catch { /* best-effort cache writes */ }
        finally {
          if (operation.kind === 'put') inFlightBytes -= operation.size;
          activeOperation = undefined;
        }
      }
    } finally {
      writing = false;
      if (disposed) {
        queue = [];
        queuedBytes = 0;
        database?.close();
        database = undefined;
      } else if (queue.length) void pump();
    }
  };

  const enqueue = (operation: WriteOperation) => {
    if (disposed) return;
    if (operation.kind === 'put') {
      if (!operation.size || operation.size > MAX_TILE_BYTES || operation.size > maxBytes || maxEntries === 0) return;
      if (queue.length + Number(writing) >= MAX_QUEUED_OPERATIONS || queuedBytes + inFlightBytes + operation.size > MAX_QUEUED_BYTES) return;
      queuedBytes += operation.size;
    } else if (queue.length + Number(writing) >= MAX_QUEUED_OPERATIONS) {
      const index = queue.findIndex(item => item.kind === 'put');
      if (index >= 0) {
        const [dropped] = queue.splice(index, 1);
        if (dropped.kind === 'put') queuedBytes -= dropped.size;
      } else if (queue.length) queue.shift();
    }
    queue.push(operation);
    void pump();
  };

  void ensureOpen().then(() => { if (!disposed) void pump(); });

  return {
    /** Optional bounded callers may wait for a cold database open before their first read. */
    async ready(): Promise<void> { await ensureOpen(); },
    async get(key: string): Promise<ArrayBuffer | undefined> {
      if (disposed || !key) return undefined;
      const hot = getMemory(key);
      if (hot) return hot;
      if (forgetPending(key)) return undefined;
      if (!database) return undefined;
      if (activeReads.size >= MAX_ACTIVE_READS) return undefined;
      let transaction: IDBTransaction;
      try { transaction = database.transaction([TILES, METADATA], 'readonly'); }
      catch { return undefined; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      return new Promise(resolve => {
        let ticket: ReadTicket | undefined;
        const finish = (value?: ArrayBuffer) => {
          if (settled) return;
          settled = true;
          if (ticket) activeReads.delete(ticket);
          if (timer !== undefined) clearTimeout(timer);
          resolve(value);
        };
        timer = setTimeout(() => {
          try { transaction.abort(); } catch { /* already completed */ }
          finish(undefined);
        }, readTimeoutMs);
        try {
          const tileRequest = transaction.objectStore(TILES).get(key);
          const metaRequest = transaction.objectStore(METADATA).get(key);
          let tileReady = false, metaReady = false;
          let tile: { key: string; value: ArrayBuffer } | undefined;
          let meta: Metadata | undefined;
          ticket = {
            key,
            invalidated: false,
            invalidate: () => {
              if (!ticket || ticket.invalidated) return;
              ticket.invalidated = true;
              try { transaction.abort(); } catch { /* already completed */ }
              finish(undefined);
            },
          };
          activeReads.add(ticket);
          const complete = () => {
            if (!tileReady || !metaReady) return;
            if (settled || ticket?.invalidated || disposed) { finish(undefined); return; }
            const entryTtl = meta ? Math.min(ttlMs, meta.ttlMs ?? ttlMs) : ttlMs;
            if (!tile || !meta || Date.now() - meta.time > entryTtl) {
              if (tile || meta) enqueue({ kind: 'forget', key });
              finish(undefined);
              return;
            }
            try {
              rememberMemory(key, tile.value, meta.time + entryTtl, false);
              finish(tile.value.slice(0));
            } catch { finish(undefined); }
          };
          tileRequest.onsuccess = () => { if (settled || ticket?.invalidated || disposed) return; tile = tileRequest.result; tileReady = true; complete(); };
          metaRequest.onsuccess = () => { if (settled || ticket?.invalidated || disposed) return; meta = metaRequest.result; metaReady = true; complete(); };
          tileRequest.onerror = metaRequest.onerror = () => finish(undefined);
          transaction.onabort = transaction.onerror = () => finish(undefined);
        } catch { finish(undefined); }
      });
    },
    put(key: string, buffer: ArrayBuffer, entryTtlMs?: number) {
      if (disposed || !key || !(buffer instanceof ArrayBuffer)) return;
      const effectiveTtl = Math.min(ttlMs, entryTtlMs ?? ttlMs);
      if (!Number.isFinite(effectiveTtl) || effectiveTtl <= 0) return;
      const size = buffer.byteLength;
      if (!size || size > MAX_TILE_BYTES) return;
      const time = Date.now();
      const canRemember = memoryMaxBytes > 0 && size <= memoryMaxBytes;
      // Memory admission is independent from this best-effort persistent write queue.
      const canPersist = size <= maxBytes && maxEntries > 0 &&
        queue.length + Number(writing) < MAX_QUEUED_OPERATIONS &&
        queuedBytes + inFlightBytes + size <= MAX_QUEUED_BYTES;
      if (!canRemember && !canPersist) return;
      invalidateReads(key);
      const value = buffer.slice(0);
      if (canRemember) rememberMemory(key, value, time + effectiveTtl, false);
      if (canPersist) enqueue({ kind: 'put', key, value, size: value.byteLength, time, ttlMs: effectiveTtl });
    },
    forget(key: string) {
      if (!disposed && key) {
        dropMemory(key);
        invalidateReads(key);
        enqueue({ kind: 'forget', key });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateReads();
      memory.clear();
      memoryBytes = 0;
      queue = [];
      queuedBytes = 0;
      if (!writing) {
        database?.close();
        database = undefined;
      }
    },
  };
}
