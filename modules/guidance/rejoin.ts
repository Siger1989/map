import { planRoute } from '../navigation/provider.ts';
import { coordinate, metresBetween, type Coordinate, type PlannedRoute } from '../navigation/types.ts';
import type { PositionFix } from '../position/types';
import { pathOf, type Path, type Projection } from './geometry.ts';
export type Rejoin = {
  route: PlannedRoute;
  path: Path;
  target: Projection;
  origin: PositionFix;
};
export async function calculateRejoin(
  original: PlannedRoute,
  origin: PositionFix,
  target: Projection,
  signal: AbortSignal,
): Promise<Rejoin> {
  const route = await planRoute(
    { name: '当前位置', coordinates: origin.coordinates },
    { name: '接回原路线', coordinates: target.point },
    original.mode,
    signal,
  );
  signal.throwIfAborted();
  validateRejoinEndpoints(route, origin, target);
  return { route, path: pathOf(route.coordinates), target, origin };
}
export function validateRejoinEndpoints(
  route: PlannedRoute,
  origin: PositionFix,
  target: Projection,
) {
  // Requested endpoints can legitimately lie off-road. Keep the road snap
  // checks, but accept a continuous, explicitly dashed access chain produced
  // by connectRoadAccess. An unmarked coordinate jump is still not a connection.
  const snappedStart = route.snapped?.[0];
  const snappedEnd = route.snapped?.at(-1);
  const close = (a: Coordinate | undefined, b: Coordinate, limit: number) =>
    coordinate(a) && coordinate(b) && metresBetween(a, b) <= limit;
  const startLimit = Math.max(20, origin.accuracy);
  if (route.coordinates.length >= 2 && route.coordinates.every(coordinate) &&
      close(snappedStart, origin.coordinates, startLimit) &&
      close(snappedEnd, target.point, 20) &&
      close(route.coordinates[0], origin.coordinates, startLimit) &&
      close(route.coordinates.at(-1), target.point, 20)) return;

  const parts = route.segments;
  if (parts?.length && parts.some(part => part.kind === 'access') &&
      parts.every(part => (part.kind === 'road' || part.kind === 'access') &&
        part.coordinates.length >= 2 && part.coordinates.every(coordinate)) &&
      close(parts[0].coordinates[0], origin.coordinates, 0.1) &&
      close(parts.at(-1)!.coordinates.at(-1), target.point, 0.1) &&
      parts.slice(1).every((part, i) => close(parts[i].coordinates.at(-1), part.coordinates[0], 0.1))) {
    const roads = parts.filter(part => part.kind === 'road');
    const chain = parts.flatMap(part => part.coordinates)
      .filter((point, i, all) => i === 0 || point[0] !== all[i - 1][0] || point[1] !== all[i - 1][1]);
    if (roads.length && coordinate(snappedStart) && coordinate(snappedEnd) &&
        close(roads[0].coordinates[0], snappedStart, 20) &&
        close(roads.at(-1)!.coordinates.at(-1), snappedEnd, 20) &&
        (close(snappedStart, origin.coordinates, startLimit) || parts[0].kind === 'access') &&
        (close(snappedEnd, target.point, 20) || parts.at(-1)!.kind === 'access') &&
        chain.length === route.coordinates.length &&
        chain.every((point, i) => close(route.coordinates[i], point, 0.1))) return;
  }
  throw new Error('道路接入段不完整，无法连接当前位置与原路线，请重新规划。');
}
