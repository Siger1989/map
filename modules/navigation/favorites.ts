import { coordinate, type PlannedRoute, type RoutePlace, type RouteStyle } from './types.ts';
export type RouteFavorite = {
  visible?: boolean;
  id: string;
  name: string;
  savedAt: number;
  start: RoutePlace;
  end: RoutePlace;
  route: PlannedRoute;
};
export const FAVORITES_STORAGE = 'guanyun.route-favorites.v1';
export function updateFavoriteRouteStyle(items: RouteFavorite[], route: PlannedRoute, style: RouteStyle): RouteFavorite[] {
  const start = route.stops?.[0]?.coordinates ?? route.coordinates[0];
  const end = route.stops?.at(-1)?.coordinates ?? route.coordinates.at(-1);
  const samePoint = (favoritePlace: RoutePlace, coordinate: number[] | undefined) =>
    !!coordinate && favoritePlace.coordinates[0] === coordinate[0] && favoritePlace.coordinates[1] === coordinate[1];
  return items.map((item) => item.route.createdAt === route.createdAt && item.route.mode === route.mode &&
    samePoint(item.start, start) && samePoint(item.end, end)
    ? { ...item, route: { ...item.route, style } }
    : item);
}
const place = (p: unknown): p is RoutePlace =>
  !!p &&
  typeof p === 'object' &&
  'name' in p &&
  typeof p.name === 'string' &&
  'coordinates' in p &&
  coordinate(p.coordinates);
const finitePositive = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function validFavorite(value: unknown): value is RouteFavorite {
  const f = value as RouteFavorite | null,
    r = f?.route;
  return (
    !!f &&
    typeof f.id === 'string' &&
    typeof f.name === 'string' &&
    finitePositive(f.savedAt) &&
    place(f.start) &&
    place(f.end) &&
    !!r &&
    (r.name === undefined || (typeof r.name === 'string' && r.name.length <= 60)) &&
    (r.displayOpacity === undefined || (finitePositive(r.displayOpacity) && r.displayOpacity <= 1)) &&
    (r.style === undefined || (!!r.style && typeof r.style === 'object' && typeof r.style.color === 'string' && /^#[a-f0-9]{6}$/i.test(r.style.color) && typeof r.style.width === 'number' && Number.isFinite(r.style.width) && r.style.width >= 0.5 && r.style.width <= 5)) &&
    (r.trackConnections === undefined || (Array.isArray(r.trackConnections) && r.trackConnections.length <= 64 &&
      r.trackConnections.every(c => c && ['direct', 'road'].includes(c.routing) && Array.isArray(c.coordinates) && c.coordinates.length >= 2 && c.coordinates.length <= 100000 && c.coordinates.every(coordinate)))) &&
    (r.preferredTrackPath === undefined ||
      (Array.isArray(r.preferredTrackPath) &&
        r.preferredTrackPath.length >= 2 &&
        r.preferredTrackPath.length <= 100000 &&
        r.preferredTrackPath.every(coordinate))) &&
    (r.trackNetwork === undefined ||
      (Array.isArray(r.trackNetwork) &&
        r.trackNetwork.length <= 2000 &&
        r.trackNetwork.every(
          (line) =>
            Array.isArray(line) && line.length >= 2 && line.every(coordinate),
        ) &&
        r.trackNetwork.reduce((sum, line) => sum + line.length, 0) <=
          120000)) &&
    ['auto', 'bicycle', 'pedestrian', 'motorcycle'].includes(r.mode) &&
    finitePositive(r.distance) &&
    finitePositive(r.duration) &&
    finitePositive(r.createdAt) &&
    Array.isArray(r.coordinates) &&
    r.coordinates.length >= 2 &&
    r.coordinates.length <= 100000 &&
    r.coordinates.every(coordinate) &&
    Array.isArray(r.snapped) &&
    r.snapped.length === (r.stops?.length ?? 2) &&
    (r.stops === undefined ||
      (Array.isArray(r.stops) &&
        r.stops.length >= 2 &&
        r.stops.length <= 12 &&
        r.stops.every(place) &&
        r.stops[0].coordinates[0] === f.start.coordinates[0] &&
        r.stops[0].coordinates[1] === f.start.coordinates[1] &&
        r.stops.at(-1)!.coordinates[0] === f.end.coordinates[0] &&
        r.stops.at(-1)!.coordinates[1] === f.end.coordinates[1])) &&
    r.snapped.every(coordinate) &&
    Array.isArray(r.steps) &&
    r.steps.length <= 10000 &&
    r.steps.every(
      (s) =>
        s &&
        typeof s.instruction === 'string' &&
        finitePositive(s.distance) &&
        finitePositive(s.duration) &&
        finitePositive(s.elapsedSeconds) &&
        Array.isArray(s.coordinates) &&
        s.coordinates.every(coordinate),
    )
  );
}
export function parseFavorites(raw: string | null): RouteFavorite[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('收藏夹格式无效');
  return data.filter(validFavorite).slice(0, 20);
}
