import {
  coordinate,
  metresBetween,
  type PlannedRoute,
} from '../navigation/types.ts';
import type { PositionFix } from '../position/types';
import { pathOf, project, type Path, type Projection } from './geometry.ts';

export type GuidanceSession = {
  route: PlannedRoute;
  path: Path;
  checkpoints: Projection[];
  nextCheckpoint: number;
  startedAt: number;
  travelled: number;
  progress: number;
  offset: number;
  last: PositionFix | null;
  anchor: PositionFix | null;
  quality: string;
  gap: boolean;
  offRoute: boolean;
  offSince: number | null;
  arriveSince: number | null;
  arrived: boolean;
};
export const freshFix = (fix: PositionFix | null, now = Date.now()): boolean =>
  !!fix &&
  coordinate(fix.coordinates) &&
  Number.isFinite(fix.timestamp) &&
  now - fix.timestamp <= 20000 &&
  fix.timestamp <= now + 5000 &&
  Number.isFinite(fix.accuracy) &&
  fix.accuracy >= 0 &&
  fix.accuracy <= 50;
export const deviationLimit = (fix: PositionFix) =>
  Math.max(35, fix.accuracy * 2 + 10);
export function createSession(
  route: PlannedRoute,
  now = Date.now(),
): GuidanceSession {
  const path = pathOf(route.coordinates);
  if (path.length < 20) throw new Error('路线太短，请重新规划。');
  let floor = 0;
  const checkpoints = route.snapped.slice(1, -1).map((point) => {
    const hit = project(path, point, floor);
    floor = hit.distance;
    return hit;
  });
  return {
    route,
    path,
    checkpoints,
    nextCheckpoint: 0,
    startedAt: now,
    travelled: 0,
    progress: 0,
    offset: 0,
    last: null,
    anchor: null,
    quality: '等待当前位置…',
    gap: false,
    offRoute: false,
    offSince: null,
    arriveSince: null,
    arrived: false,
  };
}
export function checkpointLimit(s: GuidanceSession) {
  return s.checkpoints[s.nextCheckpoint]?.distance ?? s.path.length;
}
export function rejoinTarget(s: GuidanceSession): Projection | null {
  if (!s.last) return null;
  // Retain the next unvisited via point; a detour must not skip it.
  return project(
    s.path,
    s.last.coordinates,
    Math.max(0, s.progress - 30),
    checkpointLimit(s),
    s.progress,
  );
}
/** Only fresh fixes advance confirmation counters. Gaps/poor fixes never invent walking distance. */
export function advance(
  s: GuidanceSession,
  fix: PositionFix | null,
  now = Date.now(),
  error = '',
): GuidanceSession {
  if (s.arrived) return s;
  let quality = error;
  if (!quality && !freshFix(fix, now))
    quality = !fix
      ? '等待当前位置…'
      : fix.accuracy > 50
        ? `定位精度约±${Math.round(fix.accuracy)}米，等待更准确定位`
        : '定位已过期，等待更新';
  if (quality)
    return {
      ...s,
      quality,
      anchor: null,
      offSince: null,
      arriveSince: null,
      gap: s.gap || !!s.last,
    };
  if (!fix || (s.last && fix.timestamp <= s.last.timestamp)) return s;
  const elapsed = s.last ? (fix.timestamp - s.last.timestamp) / 1000 : 0;
  const movement = s.last
    ? metresBetween(s.last.coordinates, fix.coordinates)
    : 0;
  const speed = { pedestrian: 12, bicycle: 30, auto: 80 }[s.route.mode];
  if (
    s.last &&
    elapsed <= 30 &&
    movement > speed * elapsed + s.last.accuracy + fix.accuracy
  )
    return {
      ...s,
      quality: '定位跳动，等待稳定位置',
      anchor: null,
      offSince: null,
      arriveSince: null,
    };
  const gap = !!s.last && elapsed > 30;
  let travelled = s.travelled,
    anchor = s.anchor;
  if (!anchor || gap) anchor = fix;
  else {
    const d = metresBetween(anchor.coordinates, fix.coordinates);
    if (d >= Math.max(5, (anchor.accuracy + fix.accuracy) * 0.5)) {
      travelled += d;
      anchor = fix;
    }
  }
  const window = Math.max(100, movement * 3 + 50);
  const max = checkpointLimit(s);
  const hit = project(
    s.path,
    fix.coordinates,
    Math.max(0, s.progress - (s.offRoute ? 30 : window)),
    s.last && !gap && !s.offRoute ? Math.min(max, s.progress + window) : max,
    s.progress,
  );
  const far = hit.offset > deviationLimit(fix),
    close = hit.offset <= Math.max(20, fix.accuracy + 5);
  const offSince = far ? (s.offSince ?? fix.timestamp) : null;
  const offRoute = close
    ? false
    : far && offSince !== null && fix.timestamp - offSince >= 3000
      ? true
      : s.offRoute;
  let progress = s.progress,
    nextCheckpoint = s.nextCheckpoint;
  if (!far && !offRoute) {
    progress = hit.distance;
    const next = s.checkpoints[nextCheckpoint];
    if (
      next &&
      Math.abs(progress - next.distance) <= 35 &&
      metresBetween(fix.coordinates, next.point) <=
        Math.max(20, Math.min(35, fix.accuracy))
    )
      nextCheckpoint++;
  }
  const atEnd =
    !offRoute &&
    !far &&
    nextCheckpoint === s.checkpoints.length &&
    s.path.length - progress <= 30 &&
    metresBetween(fix.coordinates, s.path.points.at(-1)!) <=
      Math.max(20, Math.min(30, fix.accuracy));
  const arriveSince = atEnd ? (s.arriveSince ?? fix.timestamp) : null;
  const arrived = arriveSince !== null && fix.timestamp - arriveSince >= 3000;
  return {
    ...s,
    last: fix,
    anchor,
    quality: '',
    gap: s.gap || gap,
    travelled,
    progress: arrived ? s.path.length : progress,
    offset: hit.offset,
    nextCheckpoint,
    offSince,
    offRoute,
    arriveSince,
    arrived,
  };
}
