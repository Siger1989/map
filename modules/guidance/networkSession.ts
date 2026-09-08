import type { PositionFix } from '../position/types';
import {
  advance,
  createSession,
  freshFix,
  type GuidanceSession,
} from './session.ts';
import { project } from './geometry.ts';
import { routeOnNetwork } from './network.ts';

/** Evaluate the fix's age, accuracy and plausible speed before considering a branch switch. */
export function advanceNetwork(
  session: GuidanceSession,
  fix: PositionFix | null,
  now = Date.now(),
  error = '',
) {
  const next = advance(session, fix, now, error);
  if (
    !fix ||
    !freshFix(fix, now) ||
    next.quality ||
    next.arrived ||
    !session.originalRoute.trackNetwork ||
    session.departurePending ||
    (session.departureRoute && session.nextCheckpoint === 0) ||
    (session.last && fix.timestamp <= session.last.timestamp)
  )
    return next;
  const currentOffset = project(next.path, fix.coordinates).offset;
  // At junctions or parallel nearby lines retain the current choice within GPS uncertainty.
  if (currentOffset <= Math.max(8, fix.accuracy)) return next;
  const selected = routeOnNetwork(
    session.originalRoute,
    fix.coordinates,
    session.originalRoute.coordinates.at(-1)!,
    session.last?.coordinates,
  );
  if (
    selected.offset > Math.max(20, fix.accuracy + 5) ||
    selected.offset + Math.max(8, fix.accuracy) >= currentOffset ||
    selected.route.distance < 20
  )
    return next;
  const switched = createSession(selected.route, session.startedAt);
  return {
    ...switched,
    originalRoute: session.originalRoute,
    networkSwitched: true,
    travelled: next.travelled,
    last: next.last,
    anchor: next.anchor,
    quality: '',
    gap: next.gap,
    offset: selected.offset,
  };
}
