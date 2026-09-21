import type { GuidanceSession } from './session';
import type { RoutePlace } from '../navigation/types';
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
