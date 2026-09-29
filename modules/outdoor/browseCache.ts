export type BrowseTile = { z: number; x: number; y: number };

type BrowseEntry = {
  key: string;
  body: ArrayBuffer;
  status: number;
  contentType: string;
  expiresAt: number;
  tile?: BrowseTile;
  priority?: boolean;
  lastAccess: number;
};
type BrowseMeta = Omit<BrowseEntry, 'body'> & { bytes: number };
type BrowseStorage = {
  get(key: string): Promise<BrowseEntry | undefined>;
  write(entry: BrowseEntry, signal?: AbortSignal): Promise<void>;
  touch(key: string, lastAccess: number): Promise<void>;
  list(): Promise<BrowseMeta[]>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
};
type EngineOptions = {
  storage?: BrowseStorage;
  indexedDB?: IDBFactory;
  now?: () => number;
  limitBytes?: number;
  entryLimit?: number;
  entryBytesLimit?: number;
};

const DATABASE = 'shantu-browse-tiles-v1';
const META = 'metadata';
const BODIES = 'bodies';
const DEFAULT_LIMIT = 256 * 1024 * 1024;
const DEFAULT_ENTRIES = 4096;
const DEFAULT_ENTRY_LIMIT = 8 * 1024 * 1024;
const DEFAULT_TTL = 24 * 60 * 60 * 1000;
const MAX_TTL = 7 * 24 * 60 * 60 * 1000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}
function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('Could not open browse cache'));
    opening.onblocked = () => reject(new Error('Browse cache database is blocked'));
  });
}
function indexedStorage(factory: IDBFactory): BrowseStorage {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const db = () => (dbPromise ??= openDatabase(factory));
  return {
    async get(key) {
      const database = await db();
      const tx = database.transaction([META, BODIES], 'readonly');
      const metaReq = tx.objectStore(META).get(key) as IDBRequest<BrowseMeta | undefined>;
      const bodyReq = tx.objectStore(BODIES).get(key) as IDBRequest<ArrayBuffer | undefined>;
      const [meta, body] = await Promise.all([request(metaReq), request(bodyReq)]);
      await transactionDone(tx);
      return meta && body ? { ...meta, body } : undefined;
    },
    async write(entry, signal) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const database = await db();
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const tx = database.transaction([META, BODIES], 'readwrite');
      const cancel = () => { try { tx.abort(); } catch { /* Transaction may already be complete. */ } };
      signal?.addEventListener('abort', cancel, { once: true });
      tx.objectStore(META).put({ ...entry, body: undefined, bytes: entry.body.byteLength });
      tx.objectStore(BODIES).put(entry.body, entry.key);
      try { await transactionDone(tx); } finally { signal?.removeEventListener('abort', cancel); }
    },
    async touch(key, lastAccess) {
      const database = await db();
      const tx = database.transaction(META, 'readwrite');
      const store = tx.objectStore(META);
      const req = store.get(key) as IDBRequest<BrowseMeta | undefined>;
      req.onsuccess = () => { if (req.result) store.put({ ...req.result, lastAccess }); };
      await transactionDone(tx);
    },
    async list() {
      const database = await db();
      const tx = database.transaction(META, 'readonly');
      const rows = await request(tx.objectStore(META).getAll()) as BrowseMeta[];
      await transactionDone(tx);
      return rows;
    },
    async remove(keys) {
      if (!keys.length) return;
      const database = await db();
      const tx = database.transaction([META, BODIES], 'readwrite');
      for (const key of keys) { tx.objectStore(META).delete(key); tx.objectStore(BODIES).delete(key); }
      await transactionDone(tx);
    },
    async clear() {
      const database = await db();
      const tx = database.transaction([META, BODIES], 'readwrite');
      tx.objectStore(META).clear(); tx.objectStore(BODIES).clear();
      await transactionDone(tx);
    },
  };
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
function responseFrom(entry: BrowseEntry) {
  return new Response(entry.body.slice(0), {
    status: entry.status,
    headers: { 'Content-Type': entry.contentType, 'X-Shantu-Browse-Cache': 'HIT' },
  });
}
function cacheTtl(response: Response, now: number) {
  const control = response.headers.get('Cache-Control') ?? '';
  if (/\bno-store\b/i.test(control)) return 0;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*(?:"(\d+)"|(\d+))/i.exec(control);
  const ttl = maxAge ? Number(maxAge[1] ?? maxAge[2]) * 1000 : DEFAULT_TTL;
  return Math.max(0, Math.min(ttl, MAX_TTL));
}
function tileJsonResponse(response: Response, allow: boolean) {
  if (!allow || !response.ok || response.type === 'opaque' || response.status !== 200 ||
      !/^application\/(?:json|geo\+json)(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) return false;
  return true;
}
function cacheableResponse(response: Response) {
  if (!response.ok || response.type === 'opaque' || response.status === 206) return false;
  const type = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return /^(image\/(?:png|jpeg|webp|avif|gif)|application\/(?:x-protobuf|vnd\.mapbox-vector-tile|octet-stream)|font\/(?:woff2?|ttf|otf)|application\/font-woff2?)$/.test(type);
}
function validPayload(contentType: string, body: ArrayBuffer) {
  const b = new Uint8Array(body);
  const starts = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  if (contentType === 'image/png') return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (contentType === 'image/jpeg') return starts(255, 216, 255);
  if (contentType === 'image/gif') return starts(71, 73, 70, 56);
  if (contentType === 'image/webp') return starts(82, 73, 70, 70) && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  if (contentType === 'image/avif') return String.fromCharCode(...b.slice(4, 8)) === 'ftyp' && /^(avif|avis)$/.test(String.fromCharCode(...b.slice(8, 12)));
  if (contentType === 'font/woff2' || contentType === 'application/font-woff2') return starts(119, 79, 70, 50);
  if (contentType === 'font/woff') return starts(119, 79, 70, 70);
  if (contentType === 'font/ttf') return starts(0, 1, 0, 0);
  if (contentType === 'font/otf') return starts(79, 84, 84, 79);
  return !/^(?:<|\{|\[)/.test(new TextDecoder().decode(b.slice(0, 64)).trimStart());
}
function tileJsonBytesValid(body: ArrayBuffer) {
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as { tiles?: unknown };
    return Array.isArray(value.tiles) && value.tiles.length > 0 && value.tiles.every(tile => {
      if (typeof tile !== 'string') return false;
      try { return ['http:', 'https:'].includes(new URL(tile.replaceAll('{z}', '1').replaceAll('{x}', '1').replaceAll('{y}', '1').replaceAll('{quadkey}', '0')).protocol); }
      catch { return false; }
    });
  } catch { return false; }
}

export function createBrowseCacheEngine(options: EngineOptions = {}) {
  const factory = options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  const storage = options.storage ?? (factory ? indexedStorage(factory) : undefined);
  const now = options.now ?? Date.now;
  const limitBytes = options.limitBytes ?? DEFAULT_LIMIT;
  const entryLimit = options.entryLimit ?? DEFAULT_ENTRIES;
  const entryBytesLimit = options.entryBytesLimit ?? DEFAULT_ENTRY_LIMIT;
  let priorityTest: ((tile: BrowseTile) => boolean) | undefined;
  let generation = 0;
  let writes = Promise.resolve();
  let metadataSnapshot: BrowseMeta[] | undefined;
  let metadataPromise: Promise<BrowseMeta[]> | undefined;
  let lastPrunedAt = 0;
  const pending = new Set<Promise<unknown>>();
  const track = (task: Promise<unknown>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => undefined);
  };
  const enqueue = <T>(operation: () => Promise<T>) => {
    const run = writes.then(operation, operation);
    writes = run.then(() => undefined, () => undefined);
    return run;
  };
  const route = (entry: BrowseMeta) => entry.tile ? !!priorityTest?.(entry.tile) : !!entry.priority;
  const metadata = async () => {
    if (!storage) throw new Error('IndexedDB is unavailable; browsing cache cannot be read');
    if (!metadataSnapshot) {
      metadataPromise ??= storage.list().then(rows => { metadataSnapshot = rows; return rows; }).finally(() => { metadataPromise = undefined; });
      return metadataPromise;
    }
    return metadataSnapshot;
  };

  async function trim(protectedKey?: string) {
    if (!storage) return;
    const entries = await metadata();
    const current = now();
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = entries.length;
    const expired = entries.filter(entry => entry.expiresAt <= current && entry.key !== protectedKey);
    if (expired.length) {
      await storage.remove(expired.map(entry => entry.key));
      const expiredSet = new Set(expired.map(entry => entry.key));
      metadataSnapshot = entries.filter(entry => !expiredSet.has(entry.key));
      bytes -= expired.reduce((sum, entry) => sum + entry.bytes, 0);
      count -= expired.length;
    }
    if (bytes <= limitBytes && count <= entryLimit && current - lastPrunedAt < 60_000) return;
    const candidates = entries.filter(entry => entry.expiresAt > current)
      .sort((a, b) => Number(route(a)) - Number(route(b)) || a.lastAccess - b.lastAccess);
    const remove: string[] = [];
    for (const entry of candidates) {
      if (bytes <= limitBytes && count <= entryLimit) break;
      remove.push(entry.key); bytes -= entry.bytes; count--;
    }
    await storage.remove(remove);
    const removed = new Set(remove);
    metadataSnapshot = entries.filter(entry => !removed.has(entry.key) && entry.expiresAt > current);
    lastPrunedAt = current;
  }

  async function browseCachedFetch(
    url: string,
    signal: AbortSignal,
    fetcher: () => Promise<Response>,
    requestOptions: { tile?: BrowseTile; priority?: boolean; cacheable?: boolean; allowStale?: boolean; allowTileJson?: boolean } = {},
  ): Promise<Response> {
    abortIfNeeded(signal);
    const cacheKey = typeof window === 'undefined' ? url : new URL(url, window.location.origin).href;
    const canWrite = requestOptions.cacheable ?? !!requestOptions.tile;
    const requestGeneration = generation;
    if (storage) {
      try {
        const cached = await storage.get(cacheKey);
        abortIfNeeded(signal);
        if (generation !== requestGeneration) {
          abortIfNeeded(signal);
          const fresh = await fetcher();
          abortIfNeeded(signal);
          return fresh;
        }
        if (cached && (cached.expiresAt > now() || (requestOptions.allowStale ?? (typeof navigator !== 'undefined' && navigator.onLine === false))) && cached.status === 200 &&
            cached.body instanceof ArrayBuffer && cached.body.byteLength > 0 &&
            cached.body.byteLength <= entryBytesLimit &&
            (/^(image\/(?:png|jpeg|webp|avif|gif)|application\/(?:x-protobuf|vnd\.mapbox-vector-tile|octet-stream)|font\/(?:woff2?|ttf|otf)|application\/font-woff2?)$/.test(cached.contentType)
             ? validPayload(cached.contentType, cached.body)
             : /^application\/(?:json|geo\+json)$/.test(cached.contentType) && tileJsonBytesValid(cached.body))) {
          const accessTime = now();
          void enqueue(async () => {
            if (generation !== requestGeneration) return;
            await storage.touch(cacheKey, accessTime);
            const rows = await metadata();
            const row = rows.find(item => item.key === cacheKey);
            if (row) row.lastAccess = accessTime;
          }).catch(() => undefined);
          return responseFrom(cached);
        }
        if (cached && generation === requestGeneration) void enqueue(async () => {
          if (generation !== requestGeneration) return;
          await storage.remove([cacheKey]);
          if (metadataSnapshot) metadataSnapshot = metadataSnapshot.filter(row => row.key !== cacheKey);
        }).catch(() => undefined);
      } catch { /* A cache failure must not interrupt online map rendering. */ }
    }
    abortIfNeeded(signal);
    const response = await fetcher();
    abortIfNeeded(signal);
    if (!canWrite || !storage || (!cacheableResponse(response) && !tileJsonResponse(response, requestOptions.allowTileJson ?? false))) return response;
    const ttl = cacheTtl(response, now());
    if (!ttl) return response;
    track((async () => {
      try {
        abortIfNeeded(signal);
        if (generation !== requestGeneration) return;
        const body = await response.clone().arrayBuffer();
        abortIfNeeded(signal);
        if (!body.byteLength || body.byteLength > entryBytesLimit) return;
        const contentType = response.headers.get('Content-Type')!.split(';', 1)[0].trim().toLowerCase();
        if (tileJsonResponse(response, requestOptions.allowTileJson ?? false)) {
          if (!tileJsonBytesValid(body)) return;
        } else if (!validPayload(contentType, body)) return;
        abortIfNeeded(signal);
        const type = contentType;
        const entry: BrowseEntry = {
          key: cacheKey, body, status: response.status, contentType: type,
          expiresAt: now() + ttl, tile: requestOptions.tile,
          priority: requestOptions.tile ? undefined : requestOptions.priority,
          lastAccess: now(),
        };
        await enqueue(async () => {
          abortIfNeeded(signal);
          if (generation !== requestGeneration) return;
          await storage.write(entry, signal);
          const rows = await metadata();
          const { body: _body, ...metadataEntry } = entry;
          metadataSnapshot = [...rows.filter(row => row.key !== cacheKey), { ...metadataEntry, bytes: entry.body.byteLength }];
          await trim();
        });
      } catch (error) {
        if (signal.aborted) return;
        /* Quota, cloning, and IndexedDB errors never break the network response. */
      }
    })());
    return response;
  }

  return {
    browseCachedFetch,
    async browseCacheStats() {
      if (!storage) throw new Error('IndexedDB is unavailable; browsing cache statistics cannot be read');
      try {
        const entries = await metadata();
        return {
          count: entries.length,
          bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
          limitBytes,
          routeCount: entries.reduce((sum, entry) => sum + Number(route(entry)), 0),
        };
      } catch (error) { throw error; }
    },
    async clearBrowseCache() {
      generation++;
      if (!storage) throw new Error('IndexedDB is unavailable; browsing cache cannot be cleared');
      await enqueue(async () => { await storage.clear(); metadataSnapshot = []; }).catch(error => { throw error; });
    },
    setBrowseCachePriority(test: (tile: BrowseTile) => boolean) { priorityTest = test; },
    async flush() { while (pending.size) await Promise.allSettled([...pending]); await writes; },
  };
}

const engine = createBrowseCacheEngine();
export const browseCachedFetch = engine.browseCachedFetch;
export const browseCacheStats = engine.browseCacheStats;
export const clearBrowseCache = engine.clearBrowseCache;
export const setBrowseCachePriority = engine.setBrowseCachePriority;
