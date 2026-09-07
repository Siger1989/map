import { useEffect, useState } from 'react';
import { placeCenter, type PlaceName } from './placeName';
import { reversePlace } from './provider';
import type { Coordinate } from './types';

/** Resolve the settled map center; abort previous work and never show a previous region as current. */
export function usePlaceName(center: Coordinate | null, enabled: boolean) {
  const rounded = center && placeCenter(center);
  const key = enabled && rounded ? rounded.join(',') : '';
  const [result, setResult] = useState<{
    key: string;
    place: PlaceName | null;
    failed: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const online = () => setRetry((n) => n + 1);
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const place = await reversePlace(
          key.split(',').map(Number) as Coordinate,
          AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        );
        if (!controller.signal.aborted)
          setResult({ key, place, failed: false });
      } catch {
        if (!controller.signal.aborted)
          setResult({ key, place: null, failed: true });
      }
    }, 900);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, retry]);
  return key && result?.key === key ? result : null;
}
