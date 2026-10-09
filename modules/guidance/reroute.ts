import type { GuidanceSession } from './session';
import { createSession, deviationLimit, freshFix } from './session.ts';
import { pathOf, project } from './geometry.ts';
import type { PlannedRoute, RoutePlace, TravelMode } from '../navigation/types';
import type { PositionFix } from '../position/types';

export type RoutePlanner = (
  start: RoutePlace,
  end: RoutePlace,
  mode: TravelMode,
  signal: AbortSignal,
  via?: RoutePlace[],
) => Promise<PlannedRoute>;

export function shouldAutoReroute(
  session: GuidanceSession | null,
  fix: PositionFix | null,
  options: {
    now?: number;
    locationError?: string;
    online: boolean;
    hidden: boolean;
    pending: boolean;
    nextRequestAt: number;
  },
) {
  const now = options.now ?? Date.now();
  return !!session &&
    session.offRoute &&
    !session.quality &&
    !session.departurePending &&
    !session.arrived &&
    !options.locationError &&
    options.online &&
    !options.hidden &&
    !options.pending &&
    now >= options.nextRequestAt &&
    freshFix(session.last, now) &&
    freshFix(fix, now) &&
    !!session.last &&
    !!fix &&
    fix.timestamp >= session.last.timestamp &&
    project(session.path, fix.coordinates).offset > deviationLimit(fix);
}

export function shouldReplaceTrackOnDeviation(session: GuidanceSession) {
  return !session.route.trackNetwork && session.route.geometryKind !== 'track';
}

export function replacementSession(
  previous: GuidanceSession,
  target: PlannedRoute,
  latestFix: PositionFix | null,
  now = Date.now(),
) {
  const next = createSession(target, now);
  const fix = freshFix(latestFix, now)
    ? latestFix
    : freshFix(previous.last, now)
      ? previous.last
      : null;
  next.originalRoute = target;
  next.startedAt = previous.startedAt;
  next.travelled = previous.travelled;
  next.last = fix;
  next.anchor = fix;
  if (fix) next.quality = '';
  return next;
}

/** Plan from the confirmed off-route fix, then reject results that no longer fit live location. */
export async function calculateReroute(
  session: GuidanceSession,
  origin: PositionFix,
  signal: AbortSignal,
  latestFix: () => PositionFix | null,
  planner: RoutePlanner,
  now = Date.now(),
) {
  signal.throwIfAborted();
  if (!freshFix(origin, now)) throw new Error('请等待有效定位后重新规划');
  const { end, via } = remainingRoutePlaces(session);
  const route = await planner(
    { name: '当前位置', coordinates: origin.coordinates },
    end,
    session.route.mode,
    signal,
    via,
  );
  signal.throwIfAborted();
  const live = latestFix();
  const checkedAt = Date.now();
  if (
    !live ||
    !freshFix(live, checkedAt) ||
    live.timestamp < origin.timestamp ||
    project(pathOf(route.coordinates), live.coordinates).offset > deviationLimit(live)
  )
    throw new Error('位置已变化，请等待稳定定位后重新计算。');
  return { route, fix: live };
}

export function remainingRoutePlaces(session: GuidanceSession): { end: RoutePlace; via: RoutePlace[] } {
  const route = session.route;
  // The automatic approach adds the old start as a checkpoint. A new route
  // from the current position must keep real via points, not return to that start.
  const first = Math.max(session.nextCheckpoint, session.departureRoute ? 1 : 0);
  return {
    end: { name: route.stops?.at(-1)?.name || '原终点', coordinates: route.stops?.at(-1)?.coordinates ?? route.coordinates.at(-1)! },
    via: session.checkpoints.slice(first).map((p, i) => ({ name: `未到途经点 ${i + 1}`, coordinates: p.point })),
  };
}
