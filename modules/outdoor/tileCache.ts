import type { BrowseTile } from './browseCache.ts';
export const TRIP_TILE_CACHE = 'guanyun-trips-v1';
export const OFFLINE_MAP_KEY = 'shantu.offline-map-only.v1';
export function offlineMapStatus(message: string) {
  return message;
}
export function offlineMapOnly() {
  return false;
}
export async function cachedMapFetch(url: string, signal: AbortSignal, tile?: BrowseTile, viewed = false): Promise<Response> {
  signal.throwIfAborted();
  void tile; void viewed;
  return fetch(url, { signal });
}
