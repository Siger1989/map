import type { GuidanceSession } from './session';
import { createSession, deviationLimit, onRouteLimit, reliableGpsFix } from './session.ts';
import { pathOf, project } from './geometry.ts';
import type { PlannedRoute, RoutePlace, TravelMode } from '../navigation/types';
import type { PositionFix } from '../position/types';
import { checkPlanningPosition, planningFixIssue } from '../position/planningFix.ts';

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
    /** Connectivity is informational only; the planner owns online/offline fallback. */
    online?: boolean;
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
    !options.hidden &&
    !options.pending &&
    now >= options.nextRequestAt &&
    reliableGpsFix(session.last, now) &&
    reliableGpsFix(fix, now) &&
    !!session.last &&
    !!fix &&
    fix.timestamp >= session.last.timestamp &&
    // offRoute is already hysteresis-confirmed; use its return threshold here.
    project(session.path, fix.coordinates).offset > onRouteLimit(fix);
}

export function shouldReplaceTrackOnDeviation(session: GuidanceSession) {
  return !session.route.trackNetwork && session.route.geometryKind !== 'track';
}

/** Project to the saved route, even after an automatic/manual replacement route was adopted. */
export function projectOriginalRouteTarget(
  session: GuidanceSession,
  coordinates: PositionFix['coordinates'],
  progress: Pick<GuidanceSession, 'progress' | 'nextCheckpoint' | 'checkpoints'> = session,
) {
  const path = pathOf(session.originalRoute.coordinates);
  const floor = progress.nextCheckpoint > 0
    ? progress.checkpoints[progress.nextCheckpoint - 1]?.distance ?? 0
    : 0;
  const ceiling = progress.checkpoints[progress.nextCheckpoint]?.distance ?? path.length;
  return project(
    path,
    coordinates,
    Math.max(floor, progress.progress - 30),
    ceiling,
    progress.progress,
  );
}

export function replacementSession(
  previous: GuidanceSession,
  target: PlannedRoute,
  latestFix: PositionFix | null,
  now = Date.now(),
) {
  const next = createSession(target, now);
  const fix = reliableGpsFix(latestFix, now)
    ? latestFix
    : reliableGpsFix(previous.last, now)
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
  policy: 'automatic' | 'manual' = 'automatic',
) {
  signal.throwIfAborted();
  if (policy === 'manual') {
    const issue = planningFixIssue(origin, now);
    if (issue) throw new Error(issue);
  } else if (!reliableGpsFix(origin, now)) throw new Error('请等待有效定位后重新规划');
  const { end, via } = remainingRoutePlaces(session);
  const route = await planner(
    { name: '当前位置', coordinates: origin.coordinates },
    end,
    session.route.mode,
    signal,
    via,
  );
  signal.throwIfAborted();
  const checkedAt = Date.now();
  const latest = latestFix();
  const live = policy === 'manual' ? checkPlanningPosition(origin, latest, checkedAt) : latest;
  if (
    !live ||
    (policy === 'automatic' && !reliableGpsFix(live, checkedAt)) ||
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
