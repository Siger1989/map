import { legacyTerrainCacheUrl } from '../terrain/tiles.ts';
import { resourceCacheKey } from './tiandituCache.ts';
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
export async function cachedMapFetch(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
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
    if (hit?.ok) return hit;
  } catch {
    /* Online fallback is explicit below. */
  }
  if (offlineMapOnly()) throw new Error('此处地图数据未缓存，请联网补齐离线包');
  return fetch(absolute, { signal });
}
