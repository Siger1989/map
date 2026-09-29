import { nativeOffline } from './nativeOffline.ts';
import { legacyTerrainCacheUrl } from '../terrain/tiles.ts';
import { resourceCacheKey } from './tiandituCache.ts';
import { browseCachedFetch, type BrowseTile } from './browseCache.ts';
import { readBrowseCacheSettings } from './browseCachePreferences.ts';
import { tileFromUrl } from './routeCachePolicy.ts';
import { browseTileCoordinate } from './browseTileSources.ts';
export const TRIP_TILE_CACHE = 'guanyun-trips-v1';
export const OFFLINE_MAP_KEY = 'shantu.offline-map-only.v1';
export function offlineMapStatus(message: string) {
  return offlineMapOnly() && message.includes('等待网络恢复')
    ? '仅缓存地图：部分视野超出已下载范围，可联网补齐'
    : message;
}
export function offlineMapOnly() {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(OFFLINE_MAP_KEY) === 'true'
    );
  } catch {
    return false;
  }
}
/** Manual packages remain readable independently of the passive browse-cache policy. */
export async function storedMapResponse(url: string, signal: AbortSignal): Promise<Response | undefined> {
  signal.throwIfAborted();
  const absolute =
    typeof window === 'undefined'
      ? url
      : new URL(url, window.location.origin).href;
  try {
    const cache = await caches.open(TRIP_TILE_CACHE);
    const hit =
      (await cache.match(resourceCacheKey(absolute))) ??
      (legacyTerrainCacheUrl(absolute)
        ? await cache.match(legacyTerrainCacheUrl(absolute)!)
        : undefined);
    signal.throwIfAborted();
    if (hit?.ok) return hit;
  } catch {
    /* Online fallback is explicit below. */
  }
  if(nativeOffline()?.offlineHas(absolute))return fetch(absolute,{signal});
}
export async function cachedMapFetch(url: string, signal: AbortSignal, tile?: BrowseTile, viewed = false): Promise<Response> {
  signal.throwIfAborted();
  const absolute = typeof window === 'undefined' ? url : new URL(url, window.location.origin).href;
  const stored = await storedMapResponse(absolute, signal);
  if (stored) return stored;
  return browseCachedFetch(absolute, signal, async () => {
    if (offlineMapOnly()) throw new Error('此处地图数据未缓存，请联网补齐离线包');
    return fetch(absolute, { signal });
  }, {
    tile: tile ?? browseTileCoordinate(absolute) ?? tileFromUrl(absolute), cacheable: viewed && readBrowseCacheSettings().enabled,
    allowStale: offlineMapOnly() || (typeof navigator !== 'undefined' && navigator.onLine === false),
    allowTileJson: /^https:\/\/tiles\.openfreemap\.org\/planet(?:\?|$)/.test(absolute),
  });
}
