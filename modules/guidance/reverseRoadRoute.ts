import type { Coordinate, PlannedRoute, RoutePlace } from '../navigation/types.ts';

const copyCoordinate = ([longitude, latitude]: Coordinate): Coordinate => [
  longitude,
  latitude,
];

const reverseLine = (line: Coordinate[]): Coordinate[] =>
  line.slice().reverse().map(copyCoordinate);

const copyPlace = (place: RoutePlace): RoutePlace => ({
  ...place,
  coordinates: copyCoordinate(place.coordinates),
});

/**
 * Make an independent return-trip view of an already planned road route.
 *
 * Provider turn maneuvers describe the forward trip and cannot be inverted
 * reliably without asking that provider again.  Clear them so guidance uses
 * its existing generic route fallback instead of announcing a wrong turn.
 */
export function reverseRoadRoute(route: PlannedRoute): PlannedRoute {
  return {
    ...route,
    routingSource: route.routingSource ? { ...route.routingSource } : undefined,
    coordinates: reverseLine(route.coordinates),
    snapped: reverseLine(route.snapped),
    segments: route.segments
      ?.slice()
      .reverse()
      .map((segment) => ({
        ...segment,
        coordinates: reverseLine(segment.coordinates),
      })),
    roadLegs: route.roadLegs?.slice().reverse().map(reverseLine),
    trackNetwork: route.trackNetwork?.map((line) => line.map(copyCoordinate)),
    preferredTrackPath: route.preferredTrackPath
      ? reverseLine(route.preferredTrackPath)
      : undefined,
    stops: route.stops?.slice().reverse().map(copyPlace),
    steps: [],
  };
}
