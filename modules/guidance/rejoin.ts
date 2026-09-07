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
  // The route provider can snap hundreds of metres to a road. Never hide that gap as navigation.
  if (
    metresBetween(route.coordinates[0], origin.coordinates) >
      Math.max(20, origin.accuracy) ||
    metresBetween(route.coordinates.at(-1)!, target.point) > 20
  )
    throw new Error('附近道路无法接到当前位置或原路线，请移动到道路后重试。');
}
