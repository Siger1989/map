export const BROWSE_CACHE_CHANGED = 'shantu:browse-cache-settings';
export const BROWSE_CACHE_CLEARED = 'shantu:browse-cache-cleared';
const KEY = 'shantu.browse-cache.settings.v1';
export type BrowseCacheSettings = { enabled: boolean; bufferKm: number };
export function readBrowseCacheSettings(): BrowseCacheSettings {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { enabled: value.enabled !== false, bufferKm: [0.5, 1, 2].includes(value.bufferKm) ? value.bufferKm : 1 };
  } catch { return { enabled: true, bufferKm: 1 }; }
}
export function saveBrowseCacheSettings(value: BrowseCacheSettings) {
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(BROWSE_CACHE_CHANGED));
}
