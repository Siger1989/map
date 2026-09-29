import { browseCachedFetch, type BrowseTile } from '../outdoor/browseCache.ts';
import { readBrowseCacheSettings } from '../outdoor/browseCachePreferences.ts';
import { offlineMapOnly, storedMapResponse } from '../outdoor/tileCache.ts';
import { tileFromUrl } from '../outdoor/routeCachePolicy.ts';
import { browseTileCoordinate } from '../outdoor/browseTileSources.ts';

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
  tile?: BrowseTile,
): Promise<Response> {
  const stored = await storedMapResponse(url, signal);
  if (stored) return stored;
  return browseCachedFetch(url, signal, () => {
    if (offlineMapOnly()) throw new Error('此处地图数据未缓存，请联网补齐离线包');
    return fetchProviderTile(url, signal);
  }, {
    tile: tile ?? browseTileCoordinate(url) ?? tileFromUrl(url), cacheable: readBrowseCacheSettings().enabled,
    allowStale: offlineMapOnly() || (typeof navigator !== 'undefined' && navigator.onLine === false),
  });
}

/** Explicit user download: shares provider transport, without automatic cache writes. */
export async function fetchOnlineMapTile(url: string, signal: AbortSignal): Promise<Response> {
  // Reuse a fresh passive hit before charging another provider request; the caller saves it in its manual package.
  return browseCachedFetch(url, signal, () => fetchProviderTile(url, signal), { cacheable: false, allowStale: false });
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

  const endpoint = new URL('/api/map-tile', globalThis.location?.origin ?? 'http://localhost');
  endpoint.searchParams.set('url', url);
  return fetch(endpoint, {
    method: 'GET',
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
  });
}
