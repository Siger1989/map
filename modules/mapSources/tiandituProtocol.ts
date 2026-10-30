import type { AddProtocolAction, RequestTransformFunction } from 'maplibre-gl';
import { createBrowserTileCache } from './browserTileCache.ts';
import { createTiandituLoader, isTiandituTileUrl } from './tiandituLoader.ts';
import { cachedMapFetch, offlineMapTransform } from '../outdoor/tileCache.ts';

export const TIANDITU_PROTOCOL = 'shantu-tdt';
const PREFIX = `${TIANDITU_PROTOCOL}://tile/`;
let shared: ReturnType<typeof createTiandituLoader> | undefined;

/** Local private preview follows the APK's app-owned tile gateway instead of a browser Referer. */
function fetchPreviewTile(input: RequestInfo | URL, init?: RequestInit) {
  const host = globalThis.location?.hostname;
  if (process.env.NEXT_PUBLIC_SHANTU_APK_PREVIEW === '1' && (host === '127.0.0.1' || host === 'localhost' || host === '[::1]')) {
    const endpoint = new URL('/api/map-tile', globalThis.location.origin);
    endpoint.searchParams.set('url', String(input));
    return globalThis.fetch(endpoint, { ...init, referrerPolicy: 'no-referrer' });
  }
  return globalThis.fetch(input, init);
}

function sharedLoader() {
  if (shared) return shared;
  let cache: { get(key: string): Promise<ArrayBuffer | undefined>; put(key: string, bytes: ArrayBuffer, ttlMs?: number): void; forget(key: string): void } | undefined;
  try {
    const indexedDB = globalThis.indexedDB;
    if (indexedDB) {
      const store = createBrowserTileCache({
        databaseName: 'shantu-tianditu-browse-v1', indexedDB,
        ttlMs: 24 * 60 * 60 * 1000, maxBytes: 128 * 1024 * 1024, maxEntries: 8192,
      });
      cache = {
        async get(key: string) { await store.ready(); return store.get(key); },
        put: store.put, forget: store.forget,
      };
    }
  } catch { /* Restricted storage must never prevent online map loading. */ }
  shared = createTiandituLoader({ cache, fetcher: fetchPreviewTile });
  return shared;
}

/** One provider session is shared by the main, secondary and route overview maps. */
export function tiandituLoadingSnapshot() { return sharedLoader().snapshot(); }

export function tiandituRequestTransform(url: string, kind?: string) {
  return kind === 'Tile' && isTiandituTileUrl(url)
    ? { url: PREFIX + encodeURIComponent(url) }
    : { url };
}

/** Explicit cache-only browsing has priority over online loading, including on reload. */
export const mapTileRequestTransform: RequestTransformFunction = async (url, kind) => {
  const offline = await offlineMapTransform(url, kind);
  if (offline && offline.url !== url) return offline;
  return tiandituRequestTransform(url, kind);
};

/** Also used by fixed-level imagery; it keeps the existing offline-package boundary. */
export async function fetchTiandituResponse(url: string, signal: AbortSignal): Promise<Response> {
  return cachedMapFetch(url, signal, undefined, true, async (request, requestSignal) => {
    const data = await sharedLoader().load(request, requestSignal);
    return new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } });
  });
}

export const tiandituProtocol: AddProtocolAction = async (request, controller) => {
  if (!request.url.startsWith(PREFIX) || request.url.length > 16384) throw Error('地图瓦片地址无效');
  let url: string;
  try { url = decodeURIComponent(request.url.slice(PREFIX.length)); }
  catch { throw Error('地图瓦片地址无效'); }
  if (!isTiandituTileUrl(url)) throw Error('地图瓦片地址无效');
  const response = await fetchTiandituResponse(url, controller.signal);
  if (!response.ok) throw Error('地图缓存暂不可用');
  return { data: await response.arrayBuffer() };
};

const registries = new WeakSet<object>();
export function registerTiandituProtocol(registry: { addProtocol: (name: string, handler: AddProtocolAction) => void }) {
  if (registries.has(registry)) return;
  registry.addProtocol(TIANDITU_PROTOCOL, tiandituProtocol);
  registries.add(registry);
  sharedLoader(); // Begin opening persistent storage before the first tile batch.
}
