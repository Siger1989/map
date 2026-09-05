import { useEffect, useRef, useState } from 'react';
import { planRoute } from './provider';
import { validFavorite, type RouteFavorite } from './favorites';
import type {
  Coordinate,
  Endpoint,
  PlannedRoute,
  RoutePlace,
  TravelMode,
} from './types';

/** Owns route requests and invalidation; no dependency on map internals. */
export function useNavigation() {
  const [start, setStart] = useState<RoutePlace | null>(null);
  const [end, setEnd] = useState<RoutePlace | null>(null);
  const [mode, setMode] = useState<TravelMode>('auto');
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [picking, setPicking] = useState<Endpoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const invalidate = () => {
    request.current?.abort();
    setLoading(false);
    setRoute(null);
    setError('');
  };
  const place = (slot: Endpoint, value: RoutePlace) => {
    invalidate();
    (slot === 'start' ? setStart : setEnd)(value);
    setPicking(null);
  };
  useEffect(() => () => request.current?.abort(), []);
  return {
    start,
    end,
    mode,
    route,
    picking,
    loading,
    error,
    place,
    setPicking,
    restore: (favorite: RouteFavorite) => {
      if (!validFavorite(favorite)) {
        setError('收藏路线数据无效，请重新规划。');
        return;
      }
      invalidate();
      setPicking(null);
      setStart(favorite.start);
      setEnd(favorite.end);
      setMode(favorite.route.mode);
      setRoute(favorite.route);
    },
    setMode: (value: TravelMode) => {
      invalidate();
      setMode(value);
    },
    swap: () => {
      invalidate();
      setPicking(null);
      setStart(end);
      setEnd(start);
    },
    clear: () => {
      invalidate();
      setPicking(null);
      setStart(null);
      setEnd(null);
    },
    pick: (coordinates: Coordinate) => {
      if (!picking) return false;
      place(picking, {
        coordinates,
        name: `地图选点 ${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}`,
      });
      return true;
    },
    calculate: async () => {
      if (!start || !end) {
        setError('请先设置起点和终点。');
        return null;
      }
      invalidate();
      const abort = new AbortController();
      request.current = abort;
      setLoading(true);
      try {
        const result = await planRoute(start, end, mode, abort.signal);
        if (abort.signal.aborted) return null;
        setRoute(result);
        return result;
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error &&
              !['TypeError', 'TimeoutError'].includes(e.name)
              ? e.message
              : '网络连接失败或超时，请稍后重试。',
          );
        return null;
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    },
  };
}
export type NavigationState = ReturnType<typeof useNavigation>;
