import { cropRasterTile, fetchWithParentFallback, isKnownNoImageryBytes, isNoImageryResponse, NoImageryTileError } from './noImageryTile.ts';

const TDT_HOST = /^t[0-7]\.tianditu\.gov\.cn$/i;
const TDT_LAYERS = new Set(['img', 'cia', 'vec', 'cva', 'ter', 'cta', 'ibo', 'iba']);
const MAX_ZOOM = 19;
const MAX_TILE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const CACHE_READ_TIMEOUT_MS = 500;
const CACHE_KEY_TIMEOUT_MS = 100;
const IMAGE_VALIDATION_TIMEOUT_MS = 1_000;
const MAX_ACTIVE_CACHE_READS = 8;
const MAX_QUEUED_CACHE_READS = 256;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_CONCURRENT = 4;
const MAX_QUEUED_FLIGHTS = 256;
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
const DEFAULT_RETRY_MS = 1_000;
const DEFAULT_START_INTERVAL_MS = 250;
const DEFAULT_RATE_LIMIT_START_INTERVAL_MS = 1_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;
const CACHE_PREFIX = 'tianditu-wmts-v1:';

type TiandituCache = {
  get(key: string): Promise<ArrayBuffer | undefined>;
  put(key: string, bytes: ArrayBuffer, ttlMs?: number): void;
  forget(key: string): void;
};

type LoaderOptions = {
  fetcher?: typeof fetch;
  cache?: TiandituCache;
  timeoutMs?: number;
  maxConcurrent?: number;
  startIntervalMs?: number;
  cooldownFallbackMs?: number;
  now?: () => number;
  cropTile?: (bytes: ArrayBuffer, childX: number, childY: number, scale: number, signal: AbortSignal) => Promise<ArrayBuffer>;
};

type ParsedTile = { url: URL; cacheKeyInput: string; layer: string; z: number; x: number; y: number };
type Consumer = { signal: AbortSignal; resolve: (bytes: ArrayBuffer) => void; reject: (error: Error) => void; abort: () => void };
type CacheReadWaiter = {
  signal: AbortSignal;
  resolve: (acquired: true | 'capacity' | 'timeout') => void;
  reject: (error: TiandituLoadError) => void;
  abort: () => void;
  timeout?: ReturnType<typeof setTimeout>;
};
type TimingAggregate = { totalMs: number; maxMs: number; samples: number };
type Flight = {
  key: string;
  url: string;
  controller: AbortController;
  consumers: Set<Consumer>;
  started: boolean;
  settled: boolean;
  queuedAt: number;
  startedAt?: number;
  timeout?: ReturnType<typeof setTimeout>;
};

export class TiandituLoadError extends Error {
  readonly kind = 'TiandituLoadError';
  readonly code: string;
  readonly retryAt: number;
  readonly retryable: boolean;

  constructor(code: string, retryAt: number, retryable: boolean, message = safeMessage(code)) {
    super(message);
    this.name = 'TiandituLoadError';
    this.code = code;
    this.retryAt = retryAt;
    this.retryable = retryable;
  }
}

/** Accept only the registered Tianditu WMTS tile hosts and coordinate form. */
export function isTiandituTileUrl(rawUrl: string): boolean {
  return parseTiandituTileUrl(rawUrl) !== undefined;
}

export function createTiandituLoader(options: LoaderOptions = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const cache = options.cache;
  const now = options.now ?? Date.now;
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const maxConcurrent = boundedInteger(options.maxConcurrent, MAX_CONCURRENT, MAX_CONCURRENT);
  const baseStartIntervalMs = boundedInteger(options.startIntervalMs, DEFAULT_START_INTERVAL_MS, 60_000);
  let startIntervalMs = baseStartIntervalMs;
  const cooldownFallbackMs = boundedInteger(options.cooldownFallbackMs, DEFAULT_RATE_LIMIT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS);
  const flights = new Map<string, Flight>();
  const queue: Flight[] = [];
  const disposal = new AbortController();
  let cooldownUntil = 0;
  let lastStartAt = 0;
  let nextStartAt = 0;
  let fallbackCooldownCount = 0;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  let pumpTimerAt = 0;
  let active = 0;
  let activeCacheReads = 0;
  const cacheReadQueue: CacheReadWaiter[] = [];
  let disposed = false;
  let pumping = false;
  const counters = { cacheHits: 0, networkRequests: 0, errors: 0, cancelled: 0, timeouts: 0, cooldown: 0 };
  const errorCodes: Record<string, number> = {};
  const httpStatuses: Record<string, number> = {};
  let lastResponse: { status: number; type: string | null; cacheControl: string | null; age: string | null; retryAfter: string | null } | undefined;
  const cacheBypassReasons: Record<string, number> = {};
  const timings = {
    cacheLookupMs: createTimingAggregate(),
    cacheStorageMs: createTimingAggregate(),
    cachePermitWaitMs: createTimingAggregate(),
    networkQueueMs: createTimingAggregate(),
    networkMs: createTimingAggregate(),
  };

  const snapshot = () => ({
    ...counters,
    activeRequests: active,
    queuedRequests: queue.length,
    remainingCooldownMs: Math.max(0, cooldownUntil - now()),
    startIntervalMs,
    errorCodes: { ...errorCodes },
    httpStatuses: { ...httpStatuses },
    lastResponse: lastResponse ? { ...lastResponse } : undefined,
    cacheBypassReasons: { ...cacheBypassReasons },
    timings: cloneTimingAggregates(timings),
    cacheReadsActive: activeCacheReads,
    cacheReadsQueued: cacheReadQueue.length,
  });

  const countCacheBypass = (reason: string) => {
    cacheBypassReasons[reason] = (cacheBypassReasons[reason] ?? 0) + 1;
  };

  const recordTiming = (name: keyof typeof timings, startedAt: number) => {
    addTiming(timings[name], monotonicNow() - startedAt);
  };

  const assertActive = (signal: AbortSignal) => {
    if (disposed || disposal.signal.aborted) throw new TiandituLoadError('disposed', 0, false);
    if (signal.aborted) throw cancelError();
  };

  const removeQueued = (flight: Flight) => {
    const index = queue.indexOf(flight);
    if (index >= 0) queue.splice(index, 1);
  };

  const clearPumpTimer = () => {
    if (pumpTimer !== undefined) clearTimeout(pumpTimer);
    pumpTimer = undefined;
    pumpTimerAt = 0;
  };

  const schedulePump = (wakeAt: number) => {
    if (disposed) return;
    const delay = Math.min(MAX_TIMEOUT_DELAY_MS, Math.max(0, wakeAt - now()));
    const targetAt = now() + delay;
    if (pumpTimer !== undefined && pumpTimerAt <= targetAt) return;
    clearPumpTimer();
    pumpTimerAt = targetAt;
    pumpTimer = setTimeout(() => {
      pumpTimer = undefined;
      pumpTimerAt = 0;
      pump();
    }, delay);
  };

  const release = (flight: Flight, error?: TiandituLoadError | NoImageryTileError, bytes?: ArrayBuffer) => {
    if (flight.settled) return;
    if (flight.startedAt !== undefined) addTiming(timings.networkMs, monotonicNow() - flight.startedAt);
    else addTiming(timings.networkQueueMs, monotonicNow() - flight.queuedAt);
    if (error) errorCodes[error.code] = (errorCodes[error.code] ?? 0) + 1;
    flight.settled = true;
    if (flight.timeout !== undefined) clearTimeout(flight.timeout);
    removeQueued(flight);
    if (flight.started) active = Math.max(0, active - 1);
    flights.delete(flight.key);
    for (const consumer of [...flight.consumers]) {
      flight.consumers.delete(consumer);
      consumer.signal.removeEventListener('abort', consumer.abort);
      if (consumer.signal.aborted) {
        counters.cancelled++;
        consumer.reject(cancelError());
      } else if (error) {
        consumer.reject(error);
      } else {
        consumer.resolve(bytes!.slice(0));
      }
    }
    pump();
  };

  const cancelConsumer = (flight: Flight, consumer: Consumer) => {
    if (flight.settled || !flight.consumers.delete(consumer)) return;
    consumer.signal.removeEventListener('abort', consumer.abort);
    counters.cancelled++;
    consumer.reject(cancelError());
    if (flight.consumers.size === 0) {
      flight.controller.abort();
      release(flight, cancelError());
    }
  };

  const start = (flight: Flight) => {
    flight.started = true;
    flight.startedAt = monotonicNow();
    addTiming(timings.networkQueueMs, flight.startedAt - flight.queuedAt);
    active++;
    lastStartAt = now();
    nextStartAt = lastStartAt + startIntervalMs;
    counters.networkRequests++;
    flight.timeout = setTimeout(() => {
      if (flight.settled) return;
      flight.controller.abort();
      counters.timeouts++;
      counters.errors++;
      release(flight, new TiandituLoadError('timeout', now(), true));
    }, timeoutMs);
    void perform(flight).then(
      bytes => release(flight, undefined, bytes),
      error => {
        if (flight.settled) return;
        const safeError = error instanceof TiandituLoadError || error instanceof NoImageryTileError ? error :
          flight.controller.signal.aborted ? cancelError() : new TiandituLoadError('network', now(), true);
        if (safeError.code === 'cancelled') counters.cancelled++;
        else if (safeError.code !== 'no-imagery') counters.errors++;
        release(flight, safeError);
      },
    );
  };

  // Keep bounded demand queued during pacing and host cooldown; only one timer wakes the queue.
  const pump = () => {
    if (disposed || pumping) return;
    pumping = true;
    try {
      while (active < maxConcurrent && queue.length) {
        const wakeAt = Math.max(cooldownUntil, nextStartAt);
        if (wakeAt > now()) {
          schedulePump(wakeAt);
          break;
        }
        // Preserve the order delivered by MapLibre's tile scheduler. This is FIFO,
        // not a claim that network start order is strict center-first across sources.
        const flight = queue.shift()!;
        if (flight.settled || flight.consumers.size === 0) continue;
        start(flight);
      }
      if (queue.length === 0) clearPumpTimer();
    } finally {
      pumping = false;
    }
  };

  const detachCacheWaiter = (waiter: CacheReadWaiter) => {
    const index = cacheReadQueue.indexOf(waiter);
    if (index >= 0) cacheReadQueue.splice(index, 1);
    waiter.signal.removeEventListener('abort', waiter.abort);
    disposal.signal.removeEventListener('abort', waiter.abort);
    if (waiter.timeout !== undefined) clearTimeout(waiter.timeout);
  };

  const grantCacheReadSlot = () => {
    while (!disposed && activeCacheReads < MAX_ACTIVE_CACHE_READS && cacheReadQueue.length) {
      const waiter = cacheReadQueue.shift()!;
      detachCacheWaiter(waiter);
      if (waiter.signal.aborted) {
        waiter.reject(cancelError());
        continue;
      }
      activeCacheReads++;
      waiter.resolve(true);
    }
  };

  const releaseCacheReadSlot = () => {
    activeCacheReads = Math.max(0, activeCacheReads - 1);
    grantCacheReadSlot();
  };

  const acquireCacheReadSlot = (signal: AbortSignal, deadline: number): Promise<true | 'capacity' | 'timeout'> => {
    if (disposed || signal.aborted) return Promise.reject(disposed ? new TiandituLoadError('disposed', 0, false) : cancelError());
    if (activeCacheReads < MAX_ACTIVE_CACHE_READS) {
      activeCacheReads++;
      return Promise.resolve(true);
    }
    if (cacheReadQueue.length >= MAX_QUEUED_CACHE_READS) return Promise.resolve('capacity');
    return new Promise<true | 'capacity' | 'timeout'>((resolve, reject) => {
      const waiter: CacheReadWaiter = {
        signal, resolve, reject,
        abort: () => {
          detachCacheWaiter(waiter);
          reject(disposed ? new TiandituLoadError('disposed', 0, false) : cancelError());
        },
      };
      waiter.timeout = setTimeout(() => {
        detachCacheWaiter(waiter);
        resolve('timeout');
      }, Math.max(0, deadline - monotonicNow()));
      signal.addEventListener('abort', waiter.abort, { once: true });
      disposal.signal.addEventListener('abort', waiter.abort, { once: true });
      cacheReadQueue.push(waiter);
      if (signal.aborted || disposed) waiter.abort();
    });
  };

  const cacheRead = async (store: TiandituCache | undefined, key: string, signal: AbortSignal, missingStoreReason: string): Promise<ArrayBuffer | undefined> => {
    const started = monotonicNow();
    const deadline = started + CACHE_READ_TIMEOUT_MS;
    let ownsSlot = false;
    let storageStarted = false;
    if (!store) {
      countCacheBypass(missingStoreReason);
      recordTiming('cacheLookupMs', started);
      return undefined;
    }
    try {
      const permitWaitStarted = monotonicNow();
      const permit = await acquireCacheReadSlot(signal, deadline);
      ownsSlot = permit === true;
      recordTiming('cachePermitWaitMs', permitWaitStarted);
      assertActive(signal);
      if (!ownsSlot) {
        countCacheBypass(permit === 'capacity' ? 'read-queue-capacity' : 'read-queue-timeout');
        return undefined;
      }

      const storageBeganAt = monotonicNow();
      storageStarted = true;
      let storageSettled = false;
      const read = Promise.resolve().then(() => store.get(key)).then(
        bytes => {
          storageSettled = true;
          recordTiming('cacheStorageMs', storageBeganAt);
          return bytes;
        },
        () => {
          storageSettled = true;
          recordTiming('cacheStorageMs', storageBeganAt);
          countCacheBypass('storage-error');
          return undefined;
        },
      ).finally(() => {
        if (ownsSlot) {
          ownsSlot = false;
          releaseCacheReadSlot();
        }
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      const remaining = Math.max(0, deadline - monotonicNow());
      const timeout = new Promise<undefined>(resolve => {
        timer = setTimeout(() => {
          countCacheBypass('read-timeout');
          resolve(undefined);
        }, remaining);
      });
      const aborted = new Promise<undefined>((_resolve, reject) => {
        abortListener = () => reject(disposed ? new TiandituLoadError('disposed', 0, false) : cancelError());
        signal.addEventListener('abort', abortListener, { once: true });
        disposal.signal.addEventListener('abort', abortListener, { once: true });
        if (signal.aborted || disposed) abortListener();
      });
      try {
        const bytes = await Promise.race([read, timeout, aborted]);
        assertActive(signal);
        return bytes instanceof ArrayBuffer ? bytes : undefined;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (abortListener) {
          signal.removeEventListener('abort', abortListener);
          disposal.signal.removeEventListener('abort', abortListener);
        }
        // The underlying store read owns the permit until it actually settles,
        // even when the caller times out or cancels.
        if (storageSettled && ownsSlot) {
          ownsSlot = false;
          releaseCacheReadSlot();
        }
      }
    } finally {
      if (ownsSlot && !storageStarted) {
        ownsSlot = false;
        releaseCacheReadSlot();
      }
      recordTiming('cacheLookupMs', started);
    }
  };

  const loadOne = async (rawUrl: string, signal: AbortSignal): Promise<ArrayBuffer> => {
    assertActive(signal);
    const parsed = parseTiandituTileUrl(rawUrl);
    if (!parsed) throw new TiandituLoadError('invalid-url', 0, false);
    const identity = await makeCacheKey(parsed.cacheKeyInput, signal, disposal.signal, () => disposed);
    assertActive(signal);

    const persistentCache = identity.persistent ? cache : undefined;
    const cached = await cacheRead(persistentCache, identity.key, signal, identity.persistent ? 'unavailable' : 'crypto-unavailable');
    assertActive(signal);
    if (cached) {
      if (await isKnownNoImageryBytes(cached)) {
        countCacheBypass('known-no-imagery-tile');
        safeForget(persistentCache, identity.key);
      } else {
      const cachedImageValid = await isValidImage(cached, signal, disposal.signal, IMAGE_VALIDATION_TIMEOUT_MS);
      assertActive(signal);
      if (cachedImageValid) {
        counters.cacheHits++;
        return cached.slice(0);
      }
      countCacheBypass('invalid-cached-image');
      safeForget(persistentCache, identity.key);
      }
    }

    assertActive(signal);
    let flight = flights.get(identity.key);
    if (!flight) {
      const url = new URL(parsed.url.toString());
      url.protocol = 'https:';
      if (queue.length >= MAX_QUEUED_FLIGHTS) {
        const stale = queue.shift();
        if (stale) {
          counters.errors += stale.consumers.size;
          release(stale, new TiandituLoadError('queue-full', now() + DEFAULT_RETRY_MS, true));
        }
      }
      flight = { key: identity.key, url: url.toString(), controller: new AbortController(), consumers: new Set(), started: false, settled: false, queuedAt: monotonicNow() };
      flights.set(identity.key, flight);
      queue.push(flight);
    }
    assertActive(signal);
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const consumer: Consumer = {
        signal,
        resolve,
        reject,
        abort: () => cancelConsumer(flight!, consumer),
      };
      flight!.consumers.add(consumer);
      signal.addEventListener('abort', consumer.abort, { once: true });
      if (signal.aborted) consumer.abort();
      pump();
    });
  };

  const perform = async (flight: Flight): Promise<ArrayBuffer> => {
    const signal = flight.controller.signal;
    const response = await fetcher(flight.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
      signal,
    });
    if (signal.aborted) throw cancelError();
    httpStatuses[response.status] = (httpStatuses[response.status] ?? 0) + 1;
    lastResponse = { status: response.status, type: response.headers.get('Content-Type'), cacheControl: response.headers.get('Cache-Control'), age: response.headers.get('Age'), retryAfter: response.headers.get('Retry-After') };
    if (isNoImageryResponse(response)) {
      try { void response.body?.cancel().catch(() => {}); } catch { /* Ignore provider-declared missing-tile cleanup errors. */ }
      throw new NoImageryTileError();
    }
    if (response.status !== 200) {
      try { void response.body?.cancel().catch(() => {}); } catch { /* Keep the safe HTTP classification. */ }
      const status = response.status;
      if (status === 429 || status === 503) {
        const fallback = Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, cooldownFallbackMs * (2 ** fallbackCooldownCount));
        const parsed = retryAtFromHeader(response.headers.get('Retry-After'), now());
        if (!parsed.valid) fallbackCooldownCount++;
        const retryAt = Math.max(cooldownUntil, parsed.valid ? parsed.retryAt : now() + fallback);
        cooldownUntil = retryAt;
        startIntervalMs = Math.max(startIntervalMs, DEFAULT_RATE_LIMIT_START_INTERVAL_MS);
        nextStartAt = Math.max(nextStartAt, lastStartAt + startIntervalMs);
        counters.cooldown++;
        throw new TiandituLoadError('rate-limited', retryAt, true);
      }
      if (status === 401 || status === 403) throw new TiandituLoadError('unauthorized', 0, false);
      if (status === 404 || status === 410) throw new TiandituLoadError('not-found', 0, false);
      throw new TiandituLoadError('http', now() + (status >= 500 ? DEFAULT_RETRY_MS : 0), status >= 500);
    }
    const bytes = await readBoundedBody(response, signal);
    if (signal.aborted) throw cancelError();
    const valid = await isValidImage(bytes, signal, disposal.signal, IMAGE_VALIDATION_TIMEOUT_MS);
    if (signal.aborted || disposed) throw cancelError();
    if (!valid) throw new TiandituLoadError('invalid-image', 0, false);
    if (await isKnownNoImageryBytes(bytes)) throw new NoImageryTileError();
    const ttl = responseCacheTtl(response.headers, now());
    if (ttl > 0 && cache && flight.key.startsWith(CACHE_PREFIX) && !disposed) {
      const storageStarted = monotonicNow();
      try { cache.put(flight.key, bytes.slice(0), ttl); } catch { countCacheBypass('storage-write-error'); /* A failed cache write never discards a valid tile. */ }
      finally { addTiming(timings.cacheStorageMs, monotonicNow() - storageStarted); }
    }
    return bytes;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearPumpTimer();
    disposal.abort();
    for (const flight of [...flights.values()]) {
      flight.controller.abort();
      release(flight, new TiandituLoadError('disposed', 0, false));
    }
    queue.length = 0;
    cooldownUntil = 0;
  };

  const load = async (rawUrl: string, signal: AbortSignal): Promise<ArrayBuffer> => {
    const parsed = parseTiandituTileUrl(rawUrl);
    if (!parsed) throw new TiandituLoadError('invalid-url', 0, false);
    return fetchWithParentFallback({
      z: parsed.z, x: parsed.x, y: parsed.y, minZoom: 0, signal,
      tileKey: (z, x, y) => parseTiandituTileUrl(tileAt(parsed, z, x, y))?.cacheKeyInput ?? `${parsed.layer}/${z}/${x}/${y}`,
      fetchTile: (z, x, y, childSignal) => loadOne(tileAt(parsed, z, x, y), childSignal),
      cropTile: options.cropTile ?? cropRasterTile,
    });
  };

  return { load, snapshot, dispose };
}

function parseTiandituTileUrl(rawUrl: string): ParsedTile | undefined {
  try {
    const url = new URL(rawUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || !TDT_HOST.test(url.hostname)) return;
    if (url.port) return;
    const params = new Map<string, string>();
    for (const [key, value] of url.searchParams) {
      const normalized = key.toUpperCase();
      if (params.has(normalized)) return;
      params.set(normalized, value);
    }
    if (!params.get('TK')) return;
    let layer: string | undefined;
    let z: number | undefined;
    let x: number | undefined;
    let y: number | undefined;
    if (url.pathname === '/DataServer') {
      const source = /^([a-z]{3})_w$/i.exec(params.get('T') ?? '');
      if (!source) return;
      layer = source[1].toLowerCase();
      z = parseCoordinate(params.get('L'));
      x = parseCoordinate(params.get('X'));
      y = parseCoordinate(params.get('Y'));
    } else {
      const path = /^\/([a-z]{3})_w\/wmts$/i.exec(url.pathname);
      if (!path) return;
      layer = path[1].toLowerCase();
      if (params.get('SERVICE')?.toUpperCase() !== 'WMTS' ||
          params.get('REQUEST')?.toUpperCase() !== 'GETTILE' ||
          params.get('VERSION') !== '1.0.0' ||
          params.get('LAYER')?.toLowerCase() !== layer ||
          params.get('STYLE')?.toLowerCase() !== 'default' ||
          params.get('TILEMATRIXSET')?.toLowerCase() !== 'w' ||
          params.get('FORMAT')?.toLowerCase() !== 'tiles') return;
      z = parseCoordinate(params.get('TILEMATRIX'));
      x = parseCoordinate(params.get('TILECOL'));
      y = parseCoordinate(params.get('TILEROW'));
    }
    if (!layer || !TDT_LAYERS.has(layer)) return;
    if (z === undefined || x === undefined || y === undefined || z > MAX_ZOOM) return;
    const dimension = 2 ** z;
    if (x >= dimension || y >= dimension) return;
    const normalized = new URL(url.toString());
    normalized.protocol = 'https:';
    normalized.hostname = 't0.tianditu.gov.cn';
    normalized.searchParams.sort();
    return { url, cacheKeyInput: normalized.toString(), layer, z, x, y };
  } catch {
    return;
  }
}

function tileAt(parsed: ParsedTile, z: number, x: number, y: number): string {
  const url = new URL(parsed.url.toString());
  const setParameter = (name: string, value: number) => {
    const key = [...url.searchParams.keys()].find(item => item.toUpperCase() === name.toUpperCase()) ?? name;
    url.searchParams.set(key, String(value));
  };
  if (url.pathname === '/DataServer') {
    setParameter('l', z); setParameter('x', x); setParameter('y', y);
  } else {
    setParameter('TILEMATRIX', z); setParameter('TILECOL', x); setParameter('TILEROW', y);
  }
  return url.toString();
}

function parseCoordinate(value: string | undefined): number | undefined {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

async function makeCacheKey(
  value: string,
  signal: AbortSignal,
  disposalSignal: AbortSignal,
  isDisposed: () => boolean,
): Promise<{ key: string; persistent: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onConsumerAbort: (() => void) | undefined;
  let onDispose: (() => void) | undefined;
  const digestPromise = Promise.resolve().then(async () => {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle?.digest) return undefined;
    return cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  }).catch(() => undefined);
  const interrupted = new Promise<undefined>((resolve, reject) => {
    onConsumerAbort = () => reject(cancelError());
    onDispose = () => reject(new TiandituLoadError('disposed', 0, false));
    signal.addEventListener('abort', onConsumerAbort, { once: true });
    disposalSignal.addEventListener('abort', onDispose, { once: true });
    if (signal.aborted) onConsumerAbort();
    if (disposalSignal.aborted) onDispose();
  });
  const timedOut = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), CACHE_KEY_TIMEOUT_MS); });
  try {
    const digest = await Promise.race([digestPromise, interrupted, timedOut]);
    if (isDisposed() || disposalSignal.aborted) throw new TiandituLoadError('disposed', 0, false);
    if (signal.aborted) throw cancelError();
    if (!digest) return { key: `memory:${value}`, persistent: false };
    return {
      key: CACHE_PREFIX + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      persistent: true,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onConsumerAbort) signal.removeEventListener('abort', onConsumerAbort);
    if (onDispose) disposalSignal.removeEventListener('abort', onDispose);
  }
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TILE_BYTES) {
    try { void response.body?.cancel().catch(() => {}); } catch { /* Best effort. */ }
    throw new TiandituLoadError('oversize', 0, false);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_TILE_BYTES) throw new TiandituLoadError('oversize', 0, false);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw cancelError();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_TILE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new TiandituLoadError('oversize', 0, false);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* A canceled stream may already be released. */ }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function isValidImage(bytes: ArrayBuffer, signal: AbortSignal, disposalSignal: AbortSignal, timeoutMs: number): Promise<boolean> {
  const mime = imageMime(bytes);
  if (!mime || bytes.byteLength === 0 || bytes.byteLength > MAX_TILE_BYTES || signal.aborted || disposalSignal.aborted) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let image: HTMLImageElement | undefined;
  let bitmap: ImageBitmap | undefined;
  let objectUrl: string | undefined;
  let settled = false;
  let onAbort: (() => void) | undefined;
  let onDispose: (() => void) | undefined;
  const decode = (async (): Promise<boolean> => {
    try {
      if (typeof globalThis.createImageBitmap === 'function') {
        const decoded = await globalThis.createImageBitmap(new Blob([bytes], { type: mime }));
        if (settled) { decoded.close(); return false; }
        bitmap = decoded;
        return decoded.width > 0 && decoded.height > 0 && decoded.width <= 8192 && decoded.height <= 8192;
      }
      if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      image = new Image();
      const img = image;
      const valid = () => img.naturalWidth > 0 && img.naturalHeight > 0 && img.naturalWidth <= 8192 && img.naturalHeight <= 8192;
      img.onload = () => {};
      img.onerror = () => {};
      if (typeof img.decode === 'function') {
        img.src = objectUrl;
        await img.decode();
        return valid();
      }
      const loaded = new Promise<boolean>(resolve => {
        img.onload = () => resolve(valid());
        img.onerror = () => resolve(false);
      });
      img.src = objectUrl;
      return await loaded;
    } catch {
      return false;
    }
  })();
  const stopped = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    onAbort = () => resolve(false);
    onDispose = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
    disposalSignal.addEventListener('abort', onDispose, { once: true });
  });
  try {
    return await Promise.race([decode, stopped]);
  } finally {
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (onDispose) disposalSignal.removeEventListener('abort', onDispose);
    if (bitmap) bitmap.close();
    if (image) { image.onload = null; image.onerror = null; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function imageMime(bytes: ArrayBuffer): string | undefined {
  const b = new Uint8Array(bytes);
  const ascii = (start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
  if (b.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v) && ascii(12, 16) === 'IHDR') {
    const view = new DataView(bytes);
    if (view.getUint32(16) > 0 && view.getUint32(20) > 0) return 'image/png';
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217) return 'image/jpeg';
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  return undefined;
}

function responseCacheTtl(headers: Headers, now: number): number {
  const control = headers.get('Cache-Control') ?? '';
  if (/(?:^|,)\s*(?:no-store|no-cache)\b/i.test(control)) return 0;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control);
  const ageValue = Number(headers.get('Age') ?? 0);
  const ageMs = Number.isFinite(ageValue) ? Math.max(0, ageValue) * 1_000 : 0;
  let ttl: number;
  if (maxAge) {
    const seconds = Number(maxAge[1]);
    ttl = Number.isSafeInteger(seconds) ? Math.max(0, seconds * 1_000 - ageMs) : MAX_CACHE_TTL_MS;
  } else {
    const expires = Date.parse(headers.get('Expires') ?? '');
    ttl = Number.isFinite(expires) ? Math.max(0, expires - now - ageMs) : DEFAULT_CACHE_TTL_MS;
  }
  return Math.min(MAX_CACHE_TTL_MS, ttl);
}

function retryAtFromHeader(value: string | null, now: number): { retryAt: number; valid: boolean } {
  const text = value?.trim() ?? '';
  if (/^\+?\d+$/.test(text)) {
    const seconds = Number(text.replace(/^\+/, ''));
    const base = Math.max(0, Math.trunc(now));
    if (!Number.isSafeInteger(seconds) || seconds >= (Number.MAX_SAFE_INTEGER - base) / 1_000) return { retryAt: Number.MAX_SAFE_INTEGER, valid: true };
    return { retryAt: base + seconds * 1_000, valid: true };
  }
  const date = Date.parse(text);
  if (Number.isFinite(date) && date > now) return { retryAt: date, valid: true };
  return { retryAt: 0, valid: false };
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value!))) : fallback;
}

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function createTimingAggregate(): TimingAggregate {
  return { totalMs: 0, maxMs: 0, samples: 0 };
}

function addTiming(aggregate: TimingAggregate, duration: number): void {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  aggregate.totalMs += safeDuration;
  aggregate.maxMs = Math.max(aggregate.maxMs, safeDuration);
  aggregate.samples++;
}

function cloneTimingAggregates<T extends Record<string, TimingAggregate>>(aggregates: T): T {
  return Object.fromEntries(Object.entries(aggregates).map(([key, value]) => [key, { ...value }])) as T;
}

function safeForget(cache: TiandituCache | undefined, key: string) {
  try { cache?.forget(key); } catch { /* Best effort. */ }
}

function safeMessage(code: string): string {
  switch (code) {
    case 'invalid-url': return '天地图瓦片地址无效';
    case 'unauthorized': return '天地图授权暂不可用';
    case 'not-found': return '天地图瓦片不存在';
    case 'rate-limited': return '天地图服务器正在冷却';
    case 'timeout': return '天地图瓦片请求超时';
    case 'cancelled': return '天地图瓦片请求已取消';
    case 'disposed': return '天地图图源已关闭';
    case 'invalid-image': return '天地图返回的瓦片图像无效';
    case 'no-imagery': return '该级别没有影像，正在使用可用的较低级别';
    case 'oversize': return '天地图瓦片超过大小限制';
    case 'crypto-unavailable': return '瓦片缓存不可用';
    default: return '天地图瓦片暂不可用';
  }
}

function cancelError(): TiandituLoadError {
  return new TiandituLoadError('cancelled', 0, false);
}
