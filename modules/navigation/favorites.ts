import { coordinate, type PlannedRoute, type RoutePlace } from './types.ts';
export type RouteFavorite = {
  id: string;
  name: string;
  savedAt: number;
  start: RoutePlace;
  end: RoutePlace;
  route: PlannedRoute;
};
export const FAVORITES_STORAGE = 'guanyun.route-favorites.v1';
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
    ['auto', 'bicycle', 'pedestrian'].includes(r.mode) &&
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
        r.stops.length <= 10 &&
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
