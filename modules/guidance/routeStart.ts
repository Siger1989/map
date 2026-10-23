import type { GuidanceSession } from './session';
import type { RoutePlace } from '../navigation/types';

/** A reroute starts at live GPS for routing, but never moves the journey's start badge. */
export function navigationStartPlace(
  session: Pick<GuidanceSession, 'originalRoute'>,
  fallback: RoutePlace | null,
): RoutePlace {
  const original = session.originalRoute;
  return original.stops?.[0] ?? fallback ?? {
    name: '起点',
    coordinates: original.coordinates[0],
  };
}
