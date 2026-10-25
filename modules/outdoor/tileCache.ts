import { resourceCacheKey } from './tiandituCache.ts';
import type { AddProtocolAction, RequestTransformFunction } from 'maplibre-gl';
import { packageUrls } from './tripStorage.ts';
import { nativeOfflineHas, nativeOfflineRead, nativeOffline } from './nativeOffline.ts';

export type BrowseTile = { z: number; x: number; y: number };
export const TRIP_TILE_CACHE = 'guanyun-trips-v1';
export const OFFLINE_MAP_KEY = 'shantu.offline-map-only.v1';
const TRIP_INDEX_KEY = 'guanyun.trips.v1';
const NO_PACKAGE_URLS = new Set<string>();

type TripIndexEntry = { id?: unknown; urls?: unknown };
type TileFetcher = (url: string, signal: AbortSignal) => Promise<Response>;
let selectedIndexId = '';
let selectedIndexRaw = '';
let selectedPackageUrls = new Set<string>();
let selectedUrlList: string[] | undefined;
let offlineOnlyOverride: boolean | undefined;

async function selectedTripUrls(): Promise<Set<string>> {
  try {
    const selected = localStorage.getItem('shantu.offline-package.v1');
    if (!selected) return NO_PACKAGE_URLS;
    const raw = localStorage.getItem(TRIP_INDEX_KEY) ?? '[]';
    if (selected === selectedIndexId && raw === selectedIndexRaw) return selectedPackageUrls;
    const entries = JSON.parse(raw) as unknown;
    if (!Array.isArray(entries)) {
      selectedPackageUrls = new Set();
      selectedIndexId = selected;
      selectedIndexRaw = raw;
      return selectedPackageUrls;
    }
    const matching = (entries as TripIndexEntry[]).filter(entry => entry.id === selected);
    const urls = matching.length ? await packageUrls(selected) : [];
    if (selected === selectedIndexId && urls === selectedUrlList) {
      selectedIndexRaw = raw;
      return selectedPackageUrls;
    }
    selectedPackageUrls = new Set(urls.map(resourceCacheKey));
    selectedUrlList = urls;
    selectedIndexId = selected;
    selectedIndexRaw = raw;
    return selectedPackageUrls;
  } catch { selectedIndexId = ''; selectedIndexRaw = ''; selectedPackageUrls = new Set(); return selectedPackageUrls; }
}

function cacheOnlyEnabled() {
  if (offlineOnlyOverride !== undefined) return offlineOnlyOverride;
  try { return localStorage.getItem(OFFLINE_MAP_KEY) === 'true'; } catch { return false; }
}

export function offlineMapStatus(message: string) { return message; }
export function offlineMapOnly() { return cacheOnlyEnabled(); }
export function setOfflineMapOnly(enabled: boolean) { offlineOnlyOverride = enabled; }

/** Route MapLibre HTTP requests through the selected package only in cache-only mode. */
export const offlineMapTransform: RequestTransformFunction = (url, kind) => {
  if (!offlineMapOnly() || !['Source', 'Tile', 'Glyphs'].includes(kind ?? '')) return { url };
  try {
    const parsed = new URL(url, globalThis.location?.origin ?? 'http://localhost');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url };
    return { url: `tripcache://${encodeURIComponent(parsed.href)}` };
  } catch { return { url }; }
};

export const offlineMapProtocol: AddProtocolAction = async (request, controller) => {
  const url = decodeURIComponent(request.url.slice('tripcache://'.length));
  const response = await cachedMapFetch(url, controller.signal, undefined, true);
  if (!response.ok) throw new Error(`地图缓存暂不可用 (${response.status})`);
  return { data: request.type === 'json' ? await response.json() : await response.arrayBuffer() };
};

/** Read only explicitly packaged tiles. Cache-only mode fails closed on misses. */
export async function cachedMapFetch(
  url: string,
  signal: AbortSignal,
  tile?: BrowseTile,
  viewed = false,
  fetcher: TileFetcher = (request, requestSignal) => fetch(request, { signal: requestSignal }),
): Promise<Response> {
  signal.throwIfAborted();
  void tile; void viewed;
  const cacheOnly = cacheOnlyEnabled();
  const key = resourceCacheKey(url);
  const packaged = (await selectedTripUrls()).has(key);
  let cacheFailure: unknown;
  if (packaged) {
    if (window.ShantuMac?.version === 1) {
      if (await nativeOfflineHas(url)) {
        const response = await nativeOfflineRead(url);
        signal.throwIfAborted();
        if (response?.ok) return response;
      }
    }
    const bridge = nativeOffline();
    if (bridge && await nativeOfflineHas(url)) {
      const response = await fetch(`/api/offline-tile?url=${encodeURIComponent(url)}`, { signal });
      signal.throwIfAborted();
      if (response.ok) return response;
    }
    try {
      const cache = await caches.open(TRIP_TILE_CACHE);
      signal.throwIfAborted();
      const hit = await cache.match(key);
      signal.throwIfAborted();
      if (hit?.ok) return hit;
    } catch (error) { signal.throwIfAborted(); cacheFailure = error; }
  }
  if (cacheOnly) {
    if (cacheFailure) throw new Error('离线地图缓存暂不可读，请检查已选缓存包');
    throw new Error('当前缓存包没有这张地图瓦片，请联网后补齐或切换缓存包');
  }
  return fetcher(url, signal);
}
