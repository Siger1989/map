import type { PlannedRoute } from '../navigation/types';
import { coordinate, metresBetween, type Coordinate } from '../navigation/types.ts';
import type { PositionFix } from '../position/types';
import { pathOf } from './geometry.ts';
import { validateRejoinEndpoints } from './rejoin.ts';
export function atStart(route: PlannedRoute, fix: PositionFix) {
  return (
    metresBetween(fix.coordinates, route.coordinates[0]) <=
    Math.max(20, Math.min(35, fix.accuracy))
  );
}
/** The original start is a compulsory checkpoint, including loops and nearby later segments. */
export function connectDeparture(
  original: PlannedRoute,
  approach: PlannedRoute,
  fix: PositionFix,
) {
  if (original.mode !== approach.mode)
    throw new Error('接入路线与主体的出行方式不一致');
  validateRejoinEndpoints(approach, fix, {
    point: original.coordinates[0],
    distance: 0,
    offset: 0,
  });
  const length = pathOf(approach.coordinates).length;
  const combined: PlannedRoute = {
    ...original,
    segments: [...(approach.segments ?? [{ kind: 'road' as const, coordinates: approach.coordinates }]), ...(original.segments ?? [{ kind: 'road' as const, coordinates: original.coordinates }])],
    accessDistance: (approach.accessDistance ?? 0) + (original.accessDistance ?? 0),
    accessDuration: (approach.accessDuration ?? 0) + (original.accessDuration ?? 0),
    coordinates: [...approach.coordinates, ...original.coordinates],
    distance:
      approach.distance +
      original.distance +
      metresBetween(approach.coordinates.at(-1)!, original.coordinates[0]),
    duration: approach.duration + original.duration,
    snapped: [
      approach.coordinates[0],
      original.coordinates[0],
      ...original.snapped.slice(1),
    ],
    stops: [
      { name: '当前位置', coordinates: fix.coordinates },
      ...(original.stops ?? [
        { name: '主体起点', coordinates: original.coordinates[0] },
        { name: '终点', coordinates: original.coordinates.at(-1)! },
      ]),
    ],
    steps: [
      ...approach.steps,
      ...original.steps.map((s) => ({
        ...s,
        elapsedSeconds: s.elapsedSeconds + approach.duration,
      })),
    ],
  };
  return { route: combined, length };
}

/** A clearly marked straight reference used only when routing confirms no passable road. */
export function referenceDeparture(
  original: PlannedRoute,
  origin: Coordinate,
  createdAt = Date.now(),
) {
  if (!coordinate(origin)) throw new Error('当前位置无效，无法生成起点参考线。');
  const target = original.coordinates[0];
  const distance = metresBetween(origin, target);
  if (!Number.isFinite(distance) || distance < 1)
    throw new Error('当前位置已在路线起点附近。');
  const seconds = distance / ({ auto: 12, bicycle: 4, pedestrian: 1.2 }[original.mode]);
  const approach: PlannedRoute = {
    mode: original.mode,
    coordinates: [origin, target],
    segments: [{ kind: 'access', coordinates: [origin, target] }],
    distance,
    duration: seconds,
    steps: [{ kind: 'access', instruction: '沿虚线直线参考前往路线起点（不代表可通行道路）', distance, duration: seconds, elapsedSeconds: 0, coordinates: [origin, target] }],
    snapped: [origin, target],
    createdAt,
  };
  const fix: PositionFix = { coordinates: origin, accuracy: 0, timestamp: createdAt };
  return { ...connectDeparture(original, approach, fix), approach, referenceOnly: true as const };
}

export function isNoPassableRoute(error: unknown) {
  if (!(error instanceof Error) || error.name === 'AbortError' || error.name === 'NetworkFailure') return false;
  return /没有找到可通行路线|附近道路无法连通/.test(error.message);
}
