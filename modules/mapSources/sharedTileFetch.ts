type Subscriber = {
  signal: AbortSignal;
  resolve: (value: ArrayBuffer) => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
};

type Request = {
  key: string;
  controller: AbortController;
  fetch: (signal: AbortSignal) => Promise<ArrayBuffer>;
  subscribers: Set<Subscriber>;
  started: boolean;
  cancelled: boolean;
};
type FetchResult = { ok: true; value: ArrayBuffer } | { ok: false; error: unknown };

type CachedTile = { value: ArrayBuffer; bytes: number };
const MAX_CACHE_ENTRIES = 512;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('瓦片请求已取消', 'AbortError');
}

/** Bounded in-flight sharing and byte-LRU reuse for raw raster input tiles. */
export class SharedTileFetch {
  private active = 0;
  private queue: Request[] = [];
  private requests = new Map<string, Request>();
  private cache = new Map<string, CachedTile>();
  private cacheBytes = 0;
  private cacheHits = 0;
  private fetchStarts = 0;
  private sharedJoins = 0;

  constructor(private readonly maxActive = 4, private readonly maxPending = 96, private readonly maxCacheBytes = 16 * 1024 * 1024) {
    if (!Number.isInteger(maxActive) || maxActive < 1 || !Number.isInteger(maxPending) || maxPending < 0)
      throw new RangeError('瓦片请求并发限制无效');
    if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 0)
      throw new RangeError('瓦片内存复用预算无效');
  }

  request(key: string, signal: AbortSignal, fetch: (signal: AbortSignal) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    if (signal.aborted) return Promise.reject(abortReason(signal));
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits++;
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached.value.slice(0));
    }
    let request = this.requests.get(key);
    if (request?.cancelled) request = undefined;
    if (request) this.sharedJoins++;
    if (!request) {
      if (this.queue.length >= this.maxPending && this.active >= this.maxActive)
        return Promise.reject(new Error('坐标校正图源请求队列已满，请稍后重试'));
      request = { key, controller: new AbortController(), fetch, subscribers: new Set(), started: false, cancelled: false };
      this.requests.set(key, request);
      this.queue.push(request);
    }

    return new Promise((resolve, reject) => {
      const entry = request!;
      const subscriber: Subscriber = {
        signal, resolve, reject,
        onAbort: () => this.removeSubscriber(entry, subscriber, abortReason(signal)),
      };
      entry.subscribers.add(subscriber);
      signal.addEventListener('abort', subscriber.onAbort, { once: true });
      if (signal.aborted) subscriber.onAbort();
      else this.pump();
    });
  }

  private removeSubscriber(request: Request, subscriber: Subscriber, reason: unknown) {
    if (!request.subscribers.delete(subscriber)) return;
    subscriber.signal.removeEventListener('abort', subscriber.onAbort);
    subscriber.reject(reason);
    if (request.subscribers.size > 0) return;

    request.cancelled = true;
    if (this.requests.get(request.key) === request) this.requests.delete(request.key);
    if (request.started) request.controller.abort(reason);
    else this.queue = this.queue.filter(item => item !== request);
    this.pump();
  }

  private pump() {
    while (this.active < this.maxActive && this.queue.length) {
      const request = this.queue.shift()!;
      if (request.cancelled || request.subscribers.size === 0) continue;
      request.started = true;
      this.active++;
      this.fetchStarts++;
      Promise.resolve()
        .then(() => request.fetch(request.controller.signal))
        .then(
          value => this.finish(request, { ok: true, value }),
          error => this.finish(request, { ok: false, error }),
        );
    }
  }

  private finish(request: Request, result: FetchResult) {
    if (result.ok && !request.cancelled && request.subscribers.size > 0)
      this.remember(request.key, result.value);
    for (const subscriber of request.subscribers) {
      subscriber.signal.removeEventListener('abort', subscriber.onAbort);
      if (result.ok) subscriber.resolve(result.value.slice(0));
      else subscriber.reject(result.error);
    }
    request.subscribers.clear();
    if (this.requests.get(request.key) === request) this.requests.delete(request.key);
    this.active--;
    this.pump();
  }

  private remember(key: string, value: ArrayBuffer) {
    if (value.byteLength === 0 || value.byteLength > this.maxCacheBytes || this.maxCacheBytes === 0) return;
    const previous = this.cache.get(key);
    if (previous) this.cacheBytes -= previous.bytes;
    const cached = value.slice(0);
    this.cache.delete(key);
    this.cache.set(key, { value: cached, bytes: cached.byteLength });
    this.cacheBytes += cached.byteLength;
    while (this.cacheBytes > this.maxCacheBytes || this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value!;
      this.cacheBytes -= this.cache.get(oldestKey)!.bytes;
      this.cache.delete(oldestKey);
    }
  }

  /** Drop completed raw inputs, for example when their source binding is replaced. */
  clear() {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  /** Drop selected completed inputs after a decoder or warp stage rejects them. */
  forget(keys: Iterable<string>) {
    for (const key of keys) {
      const cached = this.cache.get(key);
      if (!cached) continue;
      this.cache.delete(key);
      this.cacheBytes -= cached.bytes;
    }
  }

  /** Aggregate counters only; request keys and URLs are deliberately omitted. */
  snapshot() {
    return {
      active: this.active,
      pending: this.queue.length,
      cacheEntries: this.cache.size,
      cacheBytes: this.cacheBytes,
      cacheHits: this.cacheHits,
      fetchStarts: this.fetchStarts,
      sharedJoins: this.sharedJoins,
    };
  }
}
