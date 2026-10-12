import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SEARCH_HISTORY_KEY,
  clearSearchHistory,
  getSearchHistoryStorage,
  parseSearchHistoryPayload,
  readSearchHistory,
  recordSearchHistoryEntry,
  removeSearchHistoryEntry,
  writeSearchHistory,
  type SearchHistoryStorage,
} from './searchHistory';

export function useSearchHistory() {
  const [entries, setEntries] = useState<string[]>([]);
  const entriesRef = useRef(entries);
  const storageRef = useRef<SearchHistoryStorage | null>(null);

  useEffect(() => {
    const storage = getSearchHistoryStorage();
    storageRef.current = storage;
    const initial = readSearchHistory(storage);
    entriesRef.current = initial;
    setEntries(initial);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== SEARCH_HISTORY_KEY) return;
      const next = parseSearchHistoryPayload(event.newValue);
      entriesRef.current = next;
      setEntries(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const commit = useCallback((next: string[], removeKey = false) => {
    entriesRef.current = next;
    setEntries(next);
    if (removeKey) clearSearchHistory(storageRef.current);
    else writeSearchHistory(next, storageRef.current);
  }, []);

  const record = useCallback((query: string) => {
    const next = recordSearchHistoryEntry(entriesRef.current, query);
    if (next !== entriesRef.current) commit(next);
  }, [commit]);

  const remove = useCallback((query: string) => {
    const next = removeSearchHistoryEntry(entriesRef.current, query);
    if (next !== entriesRef.current) commit(next);
  }, [commit]);

  const clear = useCallback(() => commit([], true), [commit]);

  return { entries, record, remove, clear };
}
