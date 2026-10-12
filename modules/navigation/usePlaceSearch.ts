import { useEffect, useRef, useState } from 'react';
import {
  searchPlacesDetailed,
  type PlaceSearchSource,
  type SearchPageToken,
} from './provider';
import type { Coordinate, RoutePlace } from './types';

export type DetailedPlaceSearch = Awaited<ReturnType<typeof searchPlacesDetailed>>;

type SearchResponse = {
  key: string;
  places: RoutePlace[];
  suggestions: DetailedPlaceSearch['suggestions'];
  warnings: string[];
  error: string;
  next?: SearchPageToken;
};

function appendUnique<T>(current: T[], incoming: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(current.map(keyOf));
  const result = [...current];
  for (const item of incoming) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function placeKey(place: RoutePlace) {
  return [place.source ?? '', place.name.trim().toLocaleLowerCase(), place.detail?.trim().toLocaleLowerCase() ?? '', place.coordinates[0], place.coordinates[1]].join('|');
}
function suggestionKey(suggestion: DetailedPlaceSearch['suggestions'][number]) {
  return [suggestion.query.trim().toLocaleLowerCase(), suggestion.city?.trim().toLocaleLowerCase() ?? '', suggestion.label.trim().toLocaleLowerCase()].join('|');
}

/** Shared search policy for the map search and each route stop. */
export function usePlaceSearch({
  query,
  enabled,
  composing = false,
  near,
}: {
  query: string;
  enabled: boolean;
  composing?: boolean;
  near: Coordinate | null;
}) {
  const [source, setSource] = useState<PlaceSearchSource>('auto');
  const [city, setCity] = useState('');
  const [nationwide, setNationwide] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [revision, setRevision] = useState(0);
  const nearRef = useRef(near);
  const requestRef = useRef<AbortController | null>(null);
  const pageRequestRef = useRef<AbortController | null>(null);
  const pageLoadingRef = useRef(false);
  const searchKey = JSON.stringify([query, enabled, composing, source, city, nationwide, revision]);
  const currentResponse = response?.key === searchKey ? response : null;
  const places = currentResponse?.places ?? [];
  const suggestions = currentResponse?.suggestions ?? [];
  const warnings = currentResponse?.warnings ?? [];
  const error = currentResponse?.error ?? '';
  const next = currentResponse?.next;
  const busy = busyKey === searchKey;

  useEffect(() => {
    nearRef.current = near;
  }, [near]);

  useEffect(() => {
    if (!enabled || composing || query.trim().length < 2) return;

    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(async () => {
      setBusyKey(searchKey);
      try {
        const result = await searchPlacesDetailed(
          query,
          nearRef.current,
          controller.signal,
          source,
          { city: city.trim() || undefined, nationwide },
        );
        if (controller.signal.aborted || requestRef.current !== controller) return;
        setResponse({
          key: searchKey,
          places: result.places,
          suggestions: result.suggestions,
          warnings: result.warnings,
          error: !result.places.length && !result.suggestions.length && !result.warnings.length
            ? '\u672a\u627e\u5230\u5730\u70b9\u3002\u53ef\u5c1d\u8bd5\u8865\u5145\u57ce\u5e02\u3001\u5207\u6362\u6570\u636e\u6e90\u6216\u6269\u5c55\u81f3\u5168\u56fd\u3002'
            : '',
          next: result.next,
        });
      } catch (reason) {
        if (!controller.signal.aborted && requestRef.current === controller) {
          setResponse({
            key: searchKey,
            places: [],
            suggestions: [],
            warnings: [],
            error: reason instanceof Error ? reason.message : '\u641c\u7d22\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
          });
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setBusyKey((current) => current === searchKey ? '' : current);
        }
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      requestRef.current?.abort();
      requestRef.current = null;
      pageRequestRef.current?.abort();
      pageRequestRef.current = null;
      pageLoadingRef.current = false;
    };
  }, [query, enabled, composing, source, city, nationwide, revision, searchKey]);

  const searchNow = () => setRevision((value) => value + 1);
  const loadMore = async () => {
    const page = next;
    if (!page || busy || pageLoadingRef.current || !enabled || query.trim().length < 2) return;
    pageLoadingRef.current = true;
    requestRef.current?.abort();
    pageRequestRef.current?.abort();
    setBusyKey(searchKey);
    const controller = new AbortController();
    requestRef.current = controller;
    pageRequestRef.current = controller;
    try {
      const result = await searchPlacesDetailed(
        query,
        nearRef.current,
        controller.signal,
        source,
        { city: city.trim() || undefined, nationwide, page },
      );
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setResponse((current) => {
        if (current?.key !== searchKey) return current;
        return {
          ...current,
          places: appendUnique(current.places, result.places, placeKey),
          suggestions: appendUnique(current.suggestions, result.suggestions, suggestionKey),
          warnings: appendUnique(current.warnings, result.warnings, (warning) => warning.trim().toLocaleLowerCase()),
          next: result.next,
        };
      });
    } catch (reason) {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setResponse((current) => current?.key === searchKey
          ? { ...current, error: reason instanceof Error ? reason.message : '\u52a0\u8f7d\u66f4\u591a\u7ed3\u679c\u5931\u8d25\u3002' }
          : current);
      }
    } finally {
      if (pageRequestRef.current === controller) {
        pageRequestRef.current = null;
        pageLoadingRef.current = false;
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted) setBusyKey((current) => current === searchKey ? '' : current);
      }
    }
  };

  const resetOptions = () => {
    setSource('auto');
    setCity('');
    setNationwide(false);
  };

  return {
    source,
    setSource,
    city,
    setCity,
    nationwide,
    setNationwide,
    places,
    suggestions,
    warnings,
    error,
    busy,
    next,
    loadMore,
    searchNow,
    resetOptions,
  };
}
