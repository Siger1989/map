export const SEARCH_HISTORY_KEY = 'shantu.place-search-history.v1';
export const SEARCH_HISTORY_VERSION = 1;
export const SEARCH_HISTORY_LIMIT = 12;
export const SEARCH_HISTORY_QUERY_MAX_LENGTH = 120;

export type SearchHistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function getSearchHistoryStorage(): SearchHistoryStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeSearchHistoryQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, ' ').trim().slice(0, SEARCH_HISTORY_QUERY_MAX_LENGTH).trim();
  return normalized.length > 1 ? normalized : null;
}

export function normalizeSearchHistoryEntries(values: readonly unknown[]): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const query = normalizeSearchHistoryQuery(value);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(query);
    if (entries.length >= SEARCH_HISTORY_LIMIT) break;
  }
  return entries;
}

export function recordSearchHistoryEntry(
  entries: readonly string[],
  value: string,
): string[] {
  const query = normalizeSearchHistoryQuery(value);
  if (!query) return entries as string[];
  const key = query.toLowerCase();
  return normalizeSearchHistoryEntries([
    query,
    ...entries.filter((entry) => normalizeSearchHistoryQuery(entry)?.toLowerCase() !== key),
  ]);
}

export function removeSearchHistoryEntry(
  entries: readonly string[],
  value: string,
): string[] {
  const query = normalizeSearchHistoryQuery(value);
  if (!query) return entries as string[];
  const key = query.toLowerCase();
  const kept = entries.filter((entry) => normalizeSearchHistoryQuery(entry)?.toLowerCase() !== key);
  return kept.length === entries.length ? entries as string[] : normalizeSearchHistoryEntries(kept);
}

export function parseSearchHistoryPayload(payload: string | null): string[] {
  if (payload === null) return [];
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (
      record.version !== SEARCH_HISTORY_VERSION ||
      !Array.isArray(record.entries) ||
      Object.keys(record).length !== 2 ||
      !Object.hasOwn(record, 'version') ||
      !Object.hasOwn(record, 'entries')
    ) return [];
    return normalizeSearchHistoryEntries(record.entries);
  } catch {
    return [];
  }
}

export function readSearchHistory(
  storage: SearchHistoryStorage | null = getSearchHistoryStorage(),
): string[] {
  if (!storage) return [];
  try {
    return parseSearchHistoryPayload(storage.getItem(SEARCH_HISTORY_KEY));
  } catch {
    return [];
  }
}

export function writeSearchHistory(
  entries: readonly string[],
  storage: SearchHistoryStorage | null = getSearchHistoryStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify({
      version: SEARCH_HISTORY_VERSION,
      entries: normalizeSearchHistoryEntries(entries),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearSearchHistory(
  storage: SearchHistoryStorage | null = getSearchHistoryStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SEARCH_HISTORY_KEY);
    return true;
  } catch {
    return false;
  }
}
