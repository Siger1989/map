import { createBrowserTileCache } from './browserTileCache.ts';
import { createCachedTileFetcher } from './cachedTileTransport.ts';

// Open metadata while the map itself initializes, before its first tile batch.
const browseStore = typeof globalThis.indexedDB === 'undefined' ? undefined : createBrowserTileCache();
let browserTileFetcher = browseStore ? createCachedTileFetcher(browseStore, fetchProviderTile) : undefined;
const directTileFetcher = browseStore ? createCachedTileFetcher(browseStore,(url,signal)=>fetch(url,{signal})) : undefined;
export function tileTransportSnapshot() {
  const total={hits:0,misses:0,networkRequests:0,stored:0};
  for(const reader of [browserTileFetcher,directTileFetcher])if(reader){const stats=reader.snapshot();for(const key of Object.keys(total) as (keyof typeof total)[])total[key]+=stats[key];}
  return total;
}
/** Retain direct/CORS semantics for ordinary coordinate-corrected XYZ sources. */
export function fetchDirectRasterTile(url:string,signal:AbortSignal):Promise<Response>{
  signal.throwIfAborted();
  return directTileFetcher ? directTileFetcher.fetch(url,signal) : fetch(url,{signal});
}

function isTiandituHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'tianditu.gov.cn' || normalized.endsWith('.tianditu.gov.cn');
}

const TILE_ERROR_MESSAGES: Record<string, string> = {
  url: '图源地址无效或格式不受支持',
  dns: '图源域名解析失败',
  blocked: '图源地址被安全规则拒绝',
  connect: '无法连接图源服务器',
  tls: '图源 HTTPS 证书或加密连接失败',
  timeout: '图源请求超时',
  upstream_http: '图源服务器返回错误',
  format: '图源返回的内容不是受支持的地图图片',
};

let tileRequestSequence = 0;

function tileRequestId(): string {
  try {
    const random = new Uint32Array(4);
    globalThis.crypto.getRandomValues(random);
    return `mt-${Array.from(random, (part) => part.toString(16).padStart(8, '0')).join('')}`;
  } catch {
    tileRequestSequence = (tileRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `mt-${Date.now().toString(36)}-${tileRequestSequence.toString(36)}`;
  }
}

function cancelNativeTile(requestId: string): void {
  const bridge = (globalThis as typeof globalThis & {
    GuanyunNative?: { cancelMapTile?: (id: string) => void };
  }).GuanyunNative;
  try { bridge?.cancelMapTile?.(requestId); } catch { /* Preserve AbortSignal behavior if an older bridge rejects the call. */ }
}

export class TileTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TileTransportError';
  }
}

export function tileResponseError(response: Response): TileTransportError {
  const code = response.headers.get('X-Shantu-Tile-Error') ?? '';
  return new TileTransportError(`图源加载失败：${TILE_ERROR_MESSAGES[code] ?? `图源瓦片暂不可用 (${response.status})`}`);
}

/** Fetch Tianditu browser-key tiles from the official site in the browser. */
function tiandituBrowserUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (!isTiandituHost(url.hostname)) return;
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      if (url.port === '80') url.port = '';
    }
    if (url.protocol !== 'https:') return;
    return url.toString();
  } catch {
    return;
  }
}

/** Fetch one user-map tile using the access mode required by its provider. */
export async function fetchMapTile(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  // Only interactive browsing uses the new bounded cache. Explicit downloads
  // and the removed OfflineStore/route-area cache do not participate.
  if (typeof globalThis.indexedDB === 'undefined') return fetchProviderTile(url, signal);
  browserTileFetcher ??= createCachedTileFetcher(createBrowserTileCache(), fetchProviderTile);
  return browserTileFetcher.fetch(url, signal);
}

/** Explicit user download: shares provider transport, without automatic cache writes. */
export async function fetchOnlineMapTile(url: string, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  return fetchProviderTile(url, signal);
}

async function fetchProviderTile(url: string, signal: AbortSignal): Promise<Response> {
  const browserUrl = tiandituBrowserUrl(url);
  if (browserUrl) {
    return fetch(browserUrl, {
      method: 'GET',
      signal,
      credentials: 'omit',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
    });
  }

  const requestId = tileRequestId();
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelNativeTile(requestId);
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const endpoint = new URL('/api/map-tile', globalThis.location?.origin ?? 'http://localhost');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('requestId', requestId);
  try {
    return await fetch(endpoint, {
      method: 'GET',
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
    });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
