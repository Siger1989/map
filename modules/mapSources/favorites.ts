export const MAP_SOURCE_FAVORITES_STORAGE_KEY = 'shantu-map-source-favorites-v1';
export const MAP_SOURCE_FAVORITES_CHANGED_EVENT = 'shantu-map-source-favorites-changed';

export function savedMapSourceFavoriteKey(id: string): string {
  return `saved:${id}`;
}

/** FreeMapLibrary's metadata id is the suffix of its comparison choice id. */
export function publicMapSourceFavoriteKey(id: string): string {
  return id.startsWith('public:') ? id : `public:${id}`;
}

/** The manager calls the Sentinel detail layer "detail" while comparison uses its stable id. */
export function builtinMapSourceFavoriteKey(id: 'terrain' | 'detail' | 'latest' | 'sentinel' | 'tdt-vec' | 'tdt-img' | 'tdt-ter'): string {
  return id === 'detail' ? 'sentinel' : id;
}

export function readFavoriteSourceKeys(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MAP_SOURCE_FAVORITES_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string =>
      typeof id === 'string' && id.length > 0 && id.length <= 256,
    ))];
  } catch {
    return [];
  }
}

/** Persist only source keys; map metadata, blobs and seed records stay elsewhere. */
export function writeFavoriteSourceKeys(keys: string[]): boolean {
  const unique = [...new Set(keys.filter(key => typeof key === 'string' && key.length > 0 && key.length <= 256))];
  try {
    localStorage.setItem(MAP_SOURCE_FAVORITES_STORAGE_KEY, JSON.stringify(unique));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new window.CustomEvent(MAP_SOURCE_FAVORITES_CHANGED_EVENT, { detail: unique }));
    }
    return true;
  } catch {
    return false;
  }
}

export function subscribeFavoriteSourceKeys(onChange: (keys: string[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === MAP_SOURCE_FAVORITES_STORAGE_KEY) onChange(readFavoriteSourceKeys());
  };
  const handleSameWindow = (event: Event) => {
    const keys = (event as CustomEvent<unknown>).detail;
    if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) onChange(keys);
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(MAP_SOURCE_FAVORITES_CHANGED_EVENT, handleSameWindow);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(MAP_SOURCE_FAVORITES_CHANGED_EVENT, handleSameWindow);
  };
}
