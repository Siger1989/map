import { setBrowseCachePriority } from './browseCache.ts';
import { makeRouteTilePriority } from './routeCachePolicy.ts';
import { readBrowseCacheSettings } from './browseCachePreferences.ts';

export const CACHE_ROUTE_CHANGED = 'shantu:cache-route';
let points: readonly (readonly number[])[] = [];
export function cacheRoutePoints() { return points; }
export function setCacheRoute(segments: readonly (readonly (readonly number[])[])[]) {
  points = segments.flatMap((line, index) => index ? [[NaN, NaN], ...line] : [...line]);
  refreshCacheRoutePriority();
}
export function refreshCacheRoutePriority() {
  setBrowseCachePriority(makeRouteTilePriority(points, readBrowseCacheSettings().bufferKm));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CACHE_ROUTE_CHANGED));
}
