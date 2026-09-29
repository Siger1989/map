import { useEffect } from 'react';
import { setCacheRoute, refreshCacheRoutePriority } from './browseCacheRoute';
import { BROWSE_CACHE_CHANGED } from './browseCachePreferences';

export function useBrowseCacheRoute(segments: readonly (readonly (readonly number[])[])[]) {
  useEffect(() => { setCacheRoute(segments); return () => setCacheRoute([]); }, [segments]);
  useEffect(() => {
    window.addEventListener(BROWSE_CACHE_CHANGED, refreshCacheRoutePriority);
    return () => window.removeEventListener(BROWSE_CACHE_CHANGED, refreshCacheRoutePriority);
  }, []);
}
