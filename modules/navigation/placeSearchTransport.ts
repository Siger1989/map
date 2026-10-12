export type SearchErrorCategory = 'auth' | 'rate' | 'network' | 'parameter' | 'service' | 'format' | 'noresult';
export type SearchProvider = 'tianditu' | 'photon';

export class PlaceSearchError extends Error {
  readonly category: SearchErrorCategory;
  constructor(category: SearchErrorCategory, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlaceSearchError';
    this.category = category;
  }
}

type FetchResponse = {
  ok?: boolean;
  status?: number;
  headers?: { get(name: string): string | null };
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};
export type PlaceSearchTransportOptions = {
  fetch?: (url: string, init: RequestInit) => Promise<FetchResponse>;
  now?: () => number;
  timeoutMs?: number;
  minIntervalMs?: number;
};

const messages: Record<SearchErrorCategory, string> = {
  auth: '服务授权失败，请检查地图源配置。',
  rate: '请求较多，请稍后重试。',
  network: '暂时无法连接搜索服务，请检查网络后重试。',
  parameter: '搜索服务无法处理此查询，请调整关键词后重试。',
  service: '搜索服务暂不可用。',
  format: '搜索服务返回的数据格式无法识别。',
  noresult: '未找到匹配地点。',
};
export const searchErrorMessage = (category: SearchErrorCategory) => messages[category];

function httpCategory(status: number): SearchErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status === 400 || status === 422) return 'parameter';
  return status >= 500 ? 'service' : 'format';
}

export function createPlaceSearchTransport(config: PlaceSearchTransportOptions = {}) {
  const fetcher = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? 12_000;
  const intervalMs = config.minIntervalMs ?? 1_100;
  const cache = new Map<string, { time: number; value: unknown }>();
  const nextAt = new Map<SearchProvider, number>();

  async function waitTurn(provider: SearchProvider, signal: AbortSignal) {
    const scheduleNow = Date.now;
    while (true) {
      signal.throwIfAborted();
      const delay = Math.max(0, (nextAt.get(provider) ?? 0) - scheduleNow());
      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => signal.removeEventListener('abort', onAbort);
          const onAbort = () => { clearTimeout(timer); cleanup(); reject(signal.reason); };
          const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        continue;
      }
      signal.throwIfAborted();
      // Only a request that actually reaches this turn reserves the next slot.
      // Canceled waiters leave no scheduling debt for later searches.
      nextAt.set(provider, scheduleNow() + intervalMs);
      return;
    }
  }

  async function get<T>(
    url: string,
    provider: SearchProvider,
    cacheKey: string,
    signal: AbortSignal,
    validate: (data: unknown) => T,
  ): Promise<T> {
    signal.throwIfAborted();
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.time < 5 * 60_000) return hit.value as T;
    await waitTurn(provider, signal);
    let response: FetchResponse;
    try {
      response = await fetcher(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      });
    } catch (cause) {
      if (signal.aborted) throw cause;
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      throw new PlaceSearchError(timedOut ? 'network' : 'network', searchErrorMessage('network'), { cause });
    }
    signal.throwIfAborted();
    const length = Number(response.headers?.get('content-length'));
    if (Number.isFinite(length) && length > 4_000_000)
      throw new PlaceSearchError('format', '搜索结果过大，请缩小搜索范围。');
    if (response.ok === false) {
      const category = httpCategory(Number(response.status));
      throw new PlaceSearchError(category, searchErrorMessage(category));
    }
    let data: unknown;
    try {
      const body = response.text ? await response.text() : undefined;
      if (body !== undefined) {
        if (body.length > 4_000_000) throw new PlaceSearchError('format', '搜索结果过大，请缩小搜索范围。');
        data = JSON.parse(body);
      } else if (response.json) {
        data = await response.json();
      } else {
        throw new PlaceSearchError('format', searchErrorMessage('format'));
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      if (cause instanceof PlaceSearchError) throw cause;
      const category: SearchErrorCategory = cause instanceof SyntaxError ? 'format' : 'network';
      throw new PlaceSearchError(category, searchErrorMessage(category), { cause });
    }
    signal.throwIfAborted();
    const value = validate(data);
    signal.throwIfAborted();
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { time: now(), value });
    return value;
  }
  return { get };
}
