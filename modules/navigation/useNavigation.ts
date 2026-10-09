import { useEffect, useMemo, useRef, useState } from 'react';
import { planRoute } from './provider';
import { validFavorite, type RouteFavorite } from './favorites';
import { defaultRouteName, routeNameOrDefault } from './routeName';
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
  const routeRef = useRef(route);
  routeRef.current = route;
  const [visible, setVisible] = useState(true);
  const [picking, setPickingState] = useState<Endpoint | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const invalidate = (clearRoute = true) => {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    if (clearRoute) {
      routeRef.current = null;
      setRoute(null);
    }
    setVisible(true);
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
  const calculatePlaces = async (
    values: RoutePlace[],
    selectedMode: TravelMode,
    keepPrevious = false,
    rollbackStops?: RouteStop[],
    onApplied?: (route: PlannedRoute) => void,
  ) => {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    setError('');
    if (!keepPrevious) {
      routeRef.current = null;
      setRoute(null);
    }
    try {
      const result = await planRoute(
        values[0],
        values.at(-1)!,
        selectedMode,
        abort.signal,
        values.slice(1, -1),
      );
      if (abort.signal.aborted || request.current !== abort) return null;
      const named = { ...result, name: defaultRouteName(values[0], values.at(-1)!) };
      routeRef.current = named;
      setRoute(named);
      setMode(selectedMode);
      setVisible(true);
      onApplied?.(named);
      return named;
    } catch (e) {
      if (!abort.signal.aborted && request.current === abort) {
        setError(
          e instanceof Error && !['TypeError', 'TimeoutError'].includes(e.name)
            ? e.message
            : '网络连接失败或超时，请稍后重试。',
        );
        if (keepPrevious && routeRef.current) setMode(routeRef.current.mode);
        if (rollbackStops) {
          current.current = rollbackStops;
          setStops(rollbackStops);
        }
      }
      return null;
    } finally {
      if (request.current === abort) {
        request.current = null;
        setLoading(false);
      }
    }
  };
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
      setPicking(null);
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
        return false;
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
      const restoredRoute = {
        ...favorite.route,
        name: routeNameOrDefault(favorite.route.name || favorite.name, favorite.start, favorite.end),
      };
      routeRef.current = restoredRoute;
      setRoute(restoredRoute);
      setVisible(true);
      return true;
    },
    adoptRoute: (value: PlannedRoute) => {
      request.current?.abort();
      request.current = null;
      routeRef.current = value;
      setRoute(value);
      setMode(value.mode);
      setLoading(false);
      setError('');
      setVisible(true);
    },
    setMode: (value: TravelMode, onApplied?: (route: PlannedRoute) => void) => {
      if (value === mode) return;
      setMode(value);
      const places = current.current.map((s) => s.place);
      if (!routeRef.current || places.some((p) => !p)) {
        invalidate(false);
        return;
      }
      if (routeRef.current.geometryKind === 'track') {
        request.current?.abort();
        request.current = null;
        const source = routeRef.current;
        const duration = source.distance / ({ pedestrian: 4000, bicycle: 15000, auto: 40000 }[value] / 3600);
        const updated = { ...source, mode: value, duration, createdAt: Date.now() };
        routeRef.current = updated;
        setRoute(updated);
        setLoading(false);
        setError('');
        onApplied?.(updated);
        return;
      }
      void calculatePlaces(places as RoutePlace[], value, true, undefined, onApplied);
    },
    swap: (onApplied?: (route: PlannedRoute) => void) => {
      request.current?.abort();
      request.current = null;
      setPicking(null);
      const previous = current.current;
      const reversed = [...previous].reverse();
      current.current = reversed;
      setStops(reversed);
      if (routeRef.current?.geometryKind === 'track') {
        const source = routeRef.current;
        const reversedRoute: PlannedRoute = {
          ...source,
          name: defaultRouteName(reversed[0].place!, reversed.at(-1)!.place!),
          coordinates: [...source.coordinates].reverse(),
          preferredTrackPath: source.preferredTrackPath
            ? [...source.preferredTrackPath].reverse()
            : undefined,
          trackConnections: source.trackConnections
            ? [...source.trackConnections].reverse().map((connection) => ({
                ...connection,
                coordinates: [...connection.coordinates].reverse(),
              }))
            : undefined,
          segments: source.segments
            ? [...source.segments].reverse().map((segment) => ({
                ...segment,
                coordinates: [...segment.coordinates].reverse(),
              }))
            : undefined,
          roadLegs: source.roadLegs?.slice().reverse().map((line) => [...line].reverse()),
          snapped: [...source.snapped].reverse(),
          stops: source.stops ? [...source.stops].reverse() : undefined,
          steps: [],
          createdAt: Date.now(),
        };
        routeRef.current = reversedRoute;
        setRoute(reversedRoute);
        setLoading(false);
        setError('');
        onApplied?.(reversedRoute);
        return;
      }
      const places = reversed.map((s) => s.place);
      if (routeRef.current && places.every((p): p is RoutePlace => !!p))
        void calculatePlaces(places, mode, true, previous, onApplied);
      else {
        setLoading(false);
        setError('');
        routeRef.current = null;
        setRoute(null);
      }
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
    calculate: async (onApplied?: (route: PlannedRoute) => void) => {
      const places = current.current.map((s) => s.place);
      if (places.some((p) => !p)) {
        const index = places.findIndex((p) => !p);
        setError(
          `请为${stopLabel(index, places.length)}选择搜索结果，或点右侧图钉在地图选点；只输入文字还没有坐标。`,
        );
        return null;
      }
      return calculatePlaces(places as RoutePlace[], mode, !!routeRef.current, undefined, onApplied);
    },
    rename: (value: string) => {
      const name = value.slice(0, 60).trim();
      if (!name || !route) return false;
      setRoute((current) => current ? { ...current, name } : current);
      return true;
    },
    visible,
    setVisible,
  };
}
export type NavigationState = ReturnType<typeof useNavigation>;
