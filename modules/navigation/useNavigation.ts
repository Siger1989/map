import { useEffect, useMemo, useRef, useState } from 'react';
import { planRoute } from './provider';
import { validFavorite, type RouteFavorite } from './favorites';
import { MAX_ROUTE_STOPS, moveStop, stopLabel, type RouteStop } from './stops';
import type {
  Coordinate,
  Endpoint,
  PlannedRoute,
  RoutePlace,
  TravelMode,
} from './types';
const emptyStops = (): RouteStop[] => [
  { id: 'origin', query: '', place: null },
  { id: 'destination', query: '', place: null },
];
export function useNavigation() {
  const [stops, setStops] = useState<RouteStop[]>(emptyStops);
  const current = useRef(stops);
  current.current = stops;
  const [mode, setMode] = useState<TravelMode>('auto');
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [picking, setPickingState] = useState<Endpoint | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const invalidate = () => {
    request.current?.abort();
    setLoading(false);
    setRoute(null);
    setError('');
  };
  const indexOf = (slot: Endpoint) =>
    slot === 'start' ? 0 : slot === 'end' ? current.current.length - 1 : slot;
  const setPicking = (slot: Endpoint | null) => setPickingState(slot);
  const place = (slot: Endpoint, value: RoutePlace) => {
    const index = indexOf(slot);
    if (!current.current[index]) return;
    invalidate();
    setStops((items) =>
      items.map((item, i) =>
        i === index ? { ...item, place: value, query: value.name } : item,
      ),
    );
    setPicking(null);
  };
  useEffect(() => () => request.current?.abort(), []);
  const via = useMemo(() => stops.slice(1, -1).map((s) => s.place), [stops]);
  return {
    stops,
    start: stops[0].place,
    end: stops.at(-1)!.place,
    via,
    mode,
    route,
    picking,
    loading,
    error,
    place,
    setPicking,
    pickingLabel:
      picking === null ? '' : stopLabel(indexOf(picking), stops.length),
    edit: (index: number, query: string) => {
      invalidate();
      setStops((items) =>
        items.map((s, i) => (i === index ? { ...s, query, place: null } : s)),
      );
    },
    add: () => {
      if (current.current.length >= MAX_ROUTE_STOPS) {
        setError('最多添加 8 个途经点');
        return;
      }
      invalidate();
      setPicking(null);
      setStops((items) => [
        ...items.slice(0, -1),
        { id: crypto.randomUUID(), query: '', place: null },
        items.at(-1)!,
      ]);
    },
    remove: (index: number) => {
      if (index <= 0 || index >= current.current.length - 1) return;
      invalidate();
      setPicking(null);
      setStops((items) => items.filter((_, i) => i !== index));
    },
    reorder: (from: number, to: number) => {
      const moved = moveStop(current.current, from, to);
      if (moved === current.current) return;
      invalidate();
      setPicking(null);
      setStops(moved);
    },
    restore: (favorite: RouteFavorite) => {
      if (!validFavorite(favorite)) {
        setError('收藏路线数据无效，请重新规划。');
        return;
      }
      invalidate();
      setPicking(null);
      setStops(
        (favorite.route.stops ?? [favorite.start, favorite.end]).map((p) => ({
          id: crypto.randomUUID(),
          query: p.name,
          place: p,
        })),
      );
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
      setStops((items) => [...items].reverse());
    },
    clear: () => {
      invalidate();
      setPicking(null);
      setStops(emptyStops());
    },
    pick: (coordinates: Coordinate) => {
      if (picking === null) return false;
      place(picking, {
        coordinates,
        name: `地图选点 ${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}`,
      });
      return true;
    },
    calculate: async () => {
      const places = current.current.map((s) => s.place);
      if (places.some((p) => !p)) {
        setError('请为每个地点选择搜索结果或地图位置。');
        return null;
      }
      invalidate();
      const abort = new AbortController();
      request.current = abort;
      setLoading(true);
      try {
        const values = places as RoutePlace[];
        const result = await planRoute(
          values[0],
          values.at(-1)!,
          mode,
          abort.signal,
          values.slice(1, -1),
        );
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
