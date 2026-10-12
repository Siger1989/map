import type { RoutePlace } from './types.ts';

export type PlaceCacheSource = 'auto' | 'tianditu' | 'photon';
type PublicSource = Exclude<PlaceCacheSource, 'auto'>;
type CachedPlace = {
  name: string;
  detail?: string;
  coordinates: [number, number];
  source: PublicSource;
  precision?: RoutePlace['precision'];
  coordinateSystem?: RoutePlace['coordinateSystem'];
};
type CacheEntry = { place: CachedPlace; queries: string[]; savedAt: number };
type CacheData = { version: 1; entries: CacheEntry[] };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type CacheOptions = { storage?: StorageLike | null; now?: () => number };

export const PLACE_CACHE_KEY = 'shantu.place-cache.v1';
export const PLACE_CACHE_MAX_ENTRIES = 300;
export const PLACE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PLACE_CACHE_MAX_CHARS = 512 * 1024;

const precisionValues = new Set<RoutePlace['precision']>(['address', 'poi', 'street', 'locality', 'region', 'unknown']);
const coordinateSystems = new Set<RoutePlace['coordinateSystem']>(['WGS84', 'CGCS2000']);

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function queryWords(value: string) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function utf8Length(value: string) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length * 2;
}

function cleanPlace(value: unknown): CachedPlace | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 160) : '';
  const coordinates = raw.coordinates;
  const source = raw.source;
  if (!name || !Array.isArray(coordinates) || coordinates.length < 2 ||
      !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) ||
      coordinates[0] < -180 || coordinates[0] > 180 || coordinates[1] < -90 || coordinates[1] > 90 ||
      (source !== 'tianditu' && source !== 'photon')) return null;

  const place: CachedPlace = {
    name,
    coordinates: [coordinates[0], coordinates[1]],
    source,
  };
  if (typeof raw.detail === 'string' && raw.detail.trim()) place.detail = raw.detail.trim().slice(0, 320);
  if (typeof raw.precision === 'string' && precisionValues.has(raw.precision as RoutePlace['precision'])) {
    place.precision = raw.precision as RoutePlace['precision'];
  }
  if (typeof raw.coordinateSystem === 'string' && coordinateSystems.has(raw.coordinateSystem as RoutePlace['coordinateSystem'])) {
    place.coordinateSystem = raw.coordinateSystem as RoutePlace['coordinateSystem'];
  }
  return place;
}

function cleanQueries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((query): query is string => typeof query === 'string')
    .map((query) => query.trim().replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean))].slice(0, 3);
}

function placeKey(place: CachedPlace) {
  return `${place.source}|${place.coordinates[0]}|${place.coordinates[1]}|${normalizeText(place.name)}`;
}

function cleanEntry(value: unknown, now: number): CacheEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt) ||
      raw.savedAt > now + 5 * 60 * 1000 || now - raw.savedAt > PLACE_CACHE_MAX_AGE_MS) return null;
  const place = cleanPlace(raw.place);
  if (!place) return null;
  return { place, queries: cleanQueries(raw.queries), savedAt: raw.savedAt };
}

/** Parse and validate the versioned cache. Invalid data degrades to an empty cache. */
export function parsePlaceCache(raw: string | null, now = Date.now()): CacheEntry[] {
  if (!raw || utf8Length(raw) > PLACE_CACHE_MAX_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1 ||
        !Array.isArray((parsed as { entries?: unknown }).entries)) return [];
    const entries = (parsed as { entries: unknown[] }).entries
      .map((entry) => cleanEntry(entry, now))
      .filter((entry): entry is CacheEntry => entry !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
    const deduped = new Map<string, CacheEntry>();
    for (const entry of entries) {
      const key = placeKey(entry.place);
      if (!deduped.has(key)) deduped.set(key, entry);
    }
    return [...deduped.values()].slice(0, PLACE_CACHE_MAX_ENTRIES);
  } catch {
    return [];
  }
}

function serializeEntries(entries: CacheEntry[]) {
  const kept = [...entries].sort((a, b) => b.savedAt - a.savedAt).slice(0, PLACE_CACHE_MAX_ENTRIES);
  while (kept.length) {
    const serialized = JSON.stringify({ version: 1, entries: kept } satisfies CacheData);
    if (utf8Length(serialized) <= PLACE_CACHE_MAX_CHARS) return serialized;
    kept.pop();
  }
  return JSON.stringify({ version: 1, entries: [] } satisfies CacheData);
}

function defaultStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

export function createPlaceCache({ storage = defaultStorage(), now = Date.now }: CacheOptions = {}) {
  function readEntries() {
    if (!storage) return [];
    try { return parsePlaceCache(storage.getItem(PLACE_CACHE_KEY), now()); }
    catch { return []; }
  }

  function readCachedPlaces(query: string, source: PlaceCacheSource = 'auto'): RoutePlace[] {
    const words = queryWords(query);
    if (!words.length || (source !== 'auto' && source !== 'tianditu' && source !== 'photon')) return [];
    const found = readEntries().filter(({ place, queries }) => {
      if (source !== 'auto' && place.source !== source) return false;
      const searchable = normalizeText([place.name, place.detail ?? '', ...queries].join(' '));
      return words.every((word) => searchable.includes(word));
    }).sort((a, b) => {
      const exactA = normalizeText(a.place.name) === normalizeText(query) ? 1 : 0;
      const exactB = normalizeText(b.place.name) === normalizeText(query) ? 1 : 0;
      return exactB - exactA || b.savedAt - a.savedAt;
    }).slice(0, 20);

    return found.map(({ place }) => ({
      name: place.name,
      coordinates: [place.coordinates[0], place.coordinates[1]],
      ...(place.detail ? { detail: `${place.detail} · 本机缓存 · 原来源${place.source === 'tianditu' ? '天地图' : 'Photon'}` } :
        { detail: `本机缓存 · 原来源${place.source === 'tianditu' ? '天地图' : 'Photon'}` }),
      source: 'offline' as const,
      ...(place.precision ? { precision: place.precision } : {}),
      ...(place.coordinateSystem ? { coordinateSystem: place.coordinateSystem } : {}),
    }));
  }

  function cachePlaces(query: string, places: RoutePlace[]): void {
    const cleanQuery = query.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!storage || !cleanQuery || !Array.isArray(places)) return;
    const timestamp = now();
    const queryVariants = cleanQueries([cleanQuery]);
    const byKey = new Map(readEntries().map((entry) => [placeKey(entry.place), entry]));
    for (const input of places) {
      const place = cleanPlace(input);
      if (!place) continue;
      const key = placeKey(place);
      const existing = byKey.get(key);
      byKey.set(key, {
        place,
        queries: cleanQueries([...(existing?.queries ?? []), ...queryVariants]),
        savedAt: timestamp,
      });
    }
    try { storage.setItem(PLACE_CACHE_KEY, serializeEntries([...byKey.values()])); }
    catch { /* Storage quota and privacy-mode failures are optional-cache failures. */ }
  }

  return { readCachedPlaces, cachePlaces };
}

const defaultCache = createPlaceCache();
export const readCachedPlaces = defaultCache.readCachedPlaces;
export const cachePlaces = defaultCache.cachePlaces;
