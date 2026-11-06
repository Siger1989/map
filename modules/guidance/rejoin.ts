import { planRoute } from '../navigation/provider.ts';
import { metresBetween, type PlannedRoute } from '../navigation/types.ts';
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
  // `planRoute()` runs `connectRoadAccess()`, which adds requested coordinates
  // back to route.coordinates around the snapped road path. Validate the raw
  // snapped endpoints instead, or a long straight access segment looks like an
  // exact road connection here.
  const snappedStart = route.snapped?.[0];
  const snappedEnd = route.snapped?.at(-1);
  if (
    !snappedStart ||
    !snappedEnd ||
    metresBetween(snappedStart, origin.coordinates) >
      Math.max(20, origin.accuracy) ||
    metresBetween(snappedEnd, target.point) > 20
  )
    throw new Error('附近道路无法接到当前位置或原路线，请移动到道路后重试。');
}
