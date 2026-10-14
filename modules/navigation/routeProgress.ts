import { coordinate, metresBetween, type Coordinate, type PlannedRoute } from './types.ts';

export type NavigationProgressPart = {
  kind: 'road' | 'access';
  navigationState: 'traveled' | 'future';
  coordinates: Coordinate[];
};

type CachedSegment = {
  kind: 'road' | 'access';
  coordinates: Coordinate[];
  cumulative: number[];
  start: number;
  end: number;
};

type CachedRoute = {
  segmentsReference: PlannedRoute['segments'];
  coordinatesReference: Coordinate[];
  segments: CachedSegment[];
  length: number;
};

const routeCache = new WeakMap<PlannedRoute, CachedRoute>();
const longitudeDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const interpolate = (from: Coordinate, to: Coordinate, ratio: number): Coordinate => [
  ((from[0] + longitudeDelta(from[0], to[0]) * ratio + 540) % 360) - 180,
  from[1] + (to[1] - from[1]) * ratio,
];

function cacheFor(route: PlannedRoute): CachedRoute {
  const cached = routeCache.get(route);
  if (cached && cached.segmentsReference === route.segments && cached.coordinatesReference === route.coordinates) return cached;

  const sourceSegments = route.segments ?? [{ kind: 'road' as const, coordinates: route.coordinates }];
  const segments: CachedSegment[] = [];
  let chainage = 0;
  let previousEnd: Coordinate | undefined;
  for (const segment of sourceSegments) {
    const points = segment.coordinates;
    if (!points.length || !points.every(coordinate)) continue;
    if (previousEnd) chainage += metresBetween(previousEnd, points[0]);
    const start = chainage;
    const cumulative = [0];
    for (let index = 1; index < points.length; index++) {
      cumulative.push(cumulative[index - 1] + metresBetween(points[index - 1], points[index]));
    }
    const length = cumulative.at(-1) ?? 0;
    segments.push({ kind: segment.kind, coordinates: points, cumulative, start, end: start + length });
    chainage = start + length;
    previousEnd = points.at(-1);
  }
  const next = {
    segmentsReference: route.segments,
    coordinatesReference: route.coordinates,
    segments,
    length: chainage,
  };
  routeCache.set(route, next);
  return next;
}

function lowerBound(values: number[], target: number, start = 0): number {
  let low = start;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, values.length - 1);
}

function pointAtDistance(segment: CachedSegment, distance: number): Coordinate {
  const target = Math.max(0, Math.min(segment.cumulative.at(-1) ?? 0, distance));
  if (target <= 0) return segment.coordinates[0];
  if (target >= (segment.cumulative.at(-1) ?? 0)) return segment.coordinates.at(-1)!;
  const right = Math.max(1, lowerBound(segment.cumulative, target, 1));
  const from = segment.cumulative[right - 1];
  const span = segment.cumulative[right] - from;
  return interpolate(segment.coordinates[right - 1], segment.coordinates[right], (target - from) / (span || 1));
}

function appendDistinct(points: Coordinate[], candidate: Coordinate) {
  const previous = points.at(-1);
  if (!previous || previous[0] !== candidate[0] || previous[1] !== candidate[1]) points.push(candidate);
}

function sliceSegment(segment: CachedSegment, from: number, to: number): Coordinate[] | null {
  if (to - from <= 0.001) return null;
  const length = segment.cumulative.at(-1) ?? 0;
  if (from <= 0.001 && length - to <= 0.001) {
    return segment.coordinates.length >= 2 && length > 0.001 ? segment.coordinates : null;
  }
  const points = [pointAtDistance(segment, from)];
  const first = Math.max(1, lowerBound(segment.cumulative, from, 1));
  const last = Math.max(first, lowerBound(segment.cumulative, to, first));
  for (let index = first; index < last; index++) {
    if (segment.cumulative[index] > from && segment.cumulative[index] < to) appendDistinct(points, segment.coordinates[index]);
  }
  appendDistinct(points, pointAtDistance(segment, to));
  if (points.length < 2) return null;
  return points;
}

/** Split display-only route strokes at navigation chainage; saved route geometry is untouched. */
export function createNavigationProgressParts(
  route: PlannedRoute,
  navigationProgress: number,
): NavigationProgressPart[] {
  const cache = cacheFor(route);
  const progress = Math.max(0, Math.min(cache.length, navigationProgress));
  const traveled: NavigationProgressPart[] = [];
  const future: NavigationProgressPart[] = [];

  for (const segment of cache.segments) {
    const segmentLength = (segment.cumulative.at(-1) ?? 0);
    if (segmentLength <= 0.001) continue;
    const localProgress = progress - segment.start;
    const add = (target: NavigationProgressPart[], state: NavigationProgressPart['navigationState'], from: number, to: number) => {
      const coordinates = sliceSegment(segment, from, to);
      if (coordinates) target.push({ kind: segment.kind, navigationState: state, coordinates });
    };

    if (localProgress <= 0) add(future, 'future', 0, segmentLength);
    else if (localProgress >= segmentLength) add(traveled, 'traveled', 0, segmentLength);
    else {
      add(traveled, 'traveled', 0, localProgress);
      add(future, 'future', localProgress, segmentLength);
    }
  }

  // Draw future geometry after the travelled pass so the active leg wins at crossings.
  return [...traveled, ...future];
}
