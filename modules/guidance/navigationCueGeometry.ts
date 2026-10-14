import type { FeatureCollection, LineString, Point } from 'geojson';
import { coordinate, type Coordinate, metresBetween } from '../navigation/types.ts';
import { pathOf, type Path } from './geometry.ts';

export type NavigationCueInput = {
  coordinates: Coordinate[];
  position: Coordinate;
  accuracy?: number;
  /** Suppress an invented connector when motion/accuracy contradicts a safe reference. */
  referenceAllowed?: boolean;
  progress?: number;
  cameraMode?: 'forward' | 'top';
  kind: 'route' | 'rejoin';
};

export type NavigationCueFeatureCollection = FeatureCollection<LineString | Point, {
  kind: NavigationCueInput['kind'];
  ordinal: number;
  role: 'ribbon' | 'offset-reference' | 'route-projection' | 'chevron' | 'rejoin' | 'lead';
  closeView?: boolean;
  bearing?: number;
}>;
export type NavigationCueResult = { data: NavigationCueFeatureCollection; progress?: number; referenceJoinProgress?: number };

const MAX_ROUTE_ARROWS = 24;
const MAX_REJOIN_ARROWS = 5;
const FIRST_ARROW_METRES = 20;
const ARROW_SPACING_METRES = 22;
const RIBBON_LENGTH_METRES = 500;
const MAX_RIBBON_POINTS = 128;
const LEAD_MIN_REMAINING_METRES = 60;
const LEAD_TARGET_METRES = 50;
const MAX_POSITION_OFFSET_METRES = 100;
const OFFSET_REFERENCE_BASE_METRES = 12;
const OFFSET_REFERENCE_FORWARD_METRES = 12;
const OFFSET_REFERENCE_POINTS = 32;

const deltaLongitude = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const interpolate = (a: Coordinate, b: Coordinate, t: number): Coordinate => [
  ((a[0] + deltaLongitude(a[0], b[0]) * t + 540) % 360) - 180,
  a[1] + (b[1] - a[1]) * t,
];

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

function pointAtDistance(path: Path, distance: number): Coordinate {
  const target = Math.max(0, Math.min(path.length, distance));
  if (target <= 0) return path.points[0];
  if (target >= path.length) return path.points[path.points.length - 1];
  const right = Math.max(1, lowerBound(path.cumulative, target, 1));
  const from = path.cumulative[right - 1];
  const span = path.cumulative[right] - from;
  return interpolate(path.points[right - 1], path.points[right], (target - from) / (span || 1));
}

/** Display-only chainage where the offset reference rejoins a planned route. */
export function navigationReferenceJoinProgress(
  input: NavigationCueInput | null,
  resolvedPath: Path | null,
): number | undefined {
  if (!input || input.kind !== 'route' || input.referenceAllowed === false || !resolvedPath || !coordinate(input.position) ||
    !Number.isFinite(input.progress) || !Number.isFinite(resolvedPath.length) || resolvedPath.length <= 0)
    return undefined;
  const anchor = Math.max(0, Math.min(resolvedPath.length, input.progress!));
  const positionOffset = metresBetween(pointAtDistance(resolvedPath, anchor), input.position);
  const accuracy = Number.isFinite(input.accuracy) && (input.accuracy ?? 0) >= 0 ? input.accuracy! : 0;
  if (positionOffset <= Math.max(OFFSET_REFERENCE_BASE_METRES, accuracy + 5) ||
    positionOffset > MAX_POSITION_OFFSET_METRES)
    return undefined;
  return anchor + Math.min(OFFSET_REFERENCE_FORWARD_METRES, resolvedPath.length - anchor);
}

function projectInRange(path: Path, point: Coordinate, min: number, max: number, prefer: number) {
  let best = { point: path.points[0], distance: 0, offset: Infinity };
  const firstRight = Math.max(1, lowerBound(path.cumulative, min, 1));
  const lastRight = Math.max(firstRight, lowerBound(path.cumulative, max, 1));
  const scale = 111_320 * Math.cos(point[1] * Math.PI / 180);
  for (let right = firstRight; right <= lastRight; right++) {
    const from = path.cumulative[right - 1];
    const to = path.cumulative[right];
    const length = to - from;
    if (length <= 0) continue;
    const a = path.points[right - 1];
    const b = path.points[right];
    const dx = deltaLongitude(a[0], b[0]) * scale;
    const dy = (b[1] - a[1]) * 111_320;
    const px = deltaLongitude(a[0], point[0]) * scale;
    const py = (point[1] - a[1]) * 111_320;
    const minT = Math.max(0, (min - from) / length);
    const maxT = Math.min(1, (max - from) / length);
    if (minT > maxT) continue;
    const t = Math.max(minT, Math.min(maxT, (dx * px + dy * py) / (dx * dx + dy * dy || 1)));
    const projected = interpolate(a, b, t);
    const offset = metresBetween(point, projected);
    const chainage = from + length * t;
    if (offset < best.offset - 1 ||
      (Math.abs(offset - best.offset) <= 1 && Math.abs(chainage - prefer) < Math.abs(best.distance - prefer))) {
      best = { point: projected, offset, distance: chainage };
    }
  }
  return best;
}

function tangentAt(path: Path, distance: number): { east: number; north: number } | null {
  const before = pointAtDistance(path, Math.max(0, distance - 5));
  const after = pointAtDistance(path, Math.min(path.length, distance + 5));
  const meanLatitude = (before[1] + after[1]) * Math.PI / 360;
  const east = deltaLongitude(before[0], after[0]) * 111_320 * Math.cos(meanLatitude);
  const north = (after[1] - before[1]) * 111_320;
  const length = Math.hypot(east, north);
  if (!Number.isFinite(length) || length < 0.1) return null;
  return { east: east / length, north: north / length };
}

function bearingOf(tangent: { east: number; north: number }): number {
  return (Math.atan2(tangent.east, tangent.north) * 180 / Math.PI + 360) % 360;
}

function offsetCoordinate(origin: Coordinate, east: number, north: number): Coordinate {
  const latitude = Math.max(-85, Math.min(85, origin[1]));
  const longitude = origin[0] + east / (111_320 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)));
  return [((longitude + 540) % 360) - 180, origin[1] + north / 111_320];
}

/** Bounded local-metre cubic from the real fix toward a point just ahead on route. */
function offsetReference(
  from: Coordinate,
  to: Coordinate,
  tangent: { east: number; north: number } | null,
  forwardDistance: number,
): Coordinate[] {
  const latitudeRadians = from[1] * Math.PI / 180;
  const endX = deltaLongitude(from[0], to[0]) * 111_320 * Math.cos(latitudeRadians);
  const endY = (to[1] - from[1]) * 111_320;
  if (forwardDistance < 1 || !tangent) return [from, to];
  const handleLength = forwardDistance / 2;
  const control1X = tangent.east * handleLength;
  const control1Y = tangent.north * handleLength;
  const control2X = endX - tangent.east * handleLength;
  const control2Y = endY - tangent.north * handleLength;
  const coordinates: Coordinate[] = [];
  for (let index = 0; index < OFFSET_REFERENCE_POINTS; index++) {
    const sample = index / (OFFSET_REFERENCE_POINTS - 1);
    const t = sample * sample * (3 - 2 * sample);
    const inverse = 1 - t;
    const east = 3 * inverse * inverse * t * control1X +
      3 * inverse * t * t * control2X + t * t * t * endX;
    const north = 3 * inverse * inverse * t * control1Y +
      3 * inverse * t * t * control2Y + t * t * t * endY;
    coordinates.push(offsetCoordinate(from, east, north));
  }
  return coordinates;
}

/** Sample the visible ribbon locally and cap output even for unusually dense route data. */
function ribbonSamples(path: Path, start: number, end: number): Array<{ distance: number; point: Coordinate }> {
  const samples = [{ distance: start, point: pointAtDistance(path, start) }];
  const first = Math.max(1, lowerBound(path.cumulative, start, 1));
  const last = Math.max(first, lowerBound(path.cumulative, end, first));
  const interiorCount = Math.max(0, last - first);
  const stride = Math.max(1, Math.ceil(interiorCount / (MAX_RIBBON_POINTS - 2)));
  for (let index = first; index < last; index += stride) {
    const distance = path.cumulative[index];
    if (distance > start && distance < end) samples.push({ distance, point: path.points[index] });
  }
  samples.push({ distance: end, point: pointAtDistance(path, end) });
  return samples;
}

/** Build a bounded set of forward-facing chevrons along route chainage. */
export function createNavigationCueData(
  input: NavigationCueInput | null,
  previousProgress?: number,
  resolvedPath?: Path | null,
  leadTargetMetres = LEAD_TARGET_METRES,
): NavigationCueResult {
  const features: NavigationCueFeatureCollection['features'] = [];
  const empty = (progress?: number, referenceJoinProgress?: number): NavigationCueResult => ({
    data: { type: 'FeatureCollection', features }, progress, referenceJoinProgress,
  });
  if (!input || !coordinate(input.position) || input.coordinates.length < 2 ||
    (resolvedPath === undefined && !input.coordinates.every(coordinate))) {
    return empty();
  }

  let path: Path;
  if (resolvedPath !== undefined) {
    if (!resolvedPath) return empty();
    path = resolvedPath;
  } else {
    try { path = pathOf(input.coordinates); } catch { return empty(); }
  }
  if (path.length < FIRST_ARROW_METRES) return empty();

  let anchor: number;
  if (typeof input.progress === 'number' && Number.isFinite(input.progress)) {
    anchor = Math.max(0, Math.min(path.length, input.progress));
  } else {
    const hasPrevious = typeof previousProgress === 'number' && Number.isFinite(previousProgress);
    const preferred = hasPrevious ? Math.max(0, Math.min(path.length, previousProgress)) : 0;
    const min = hasPrevious ? Math.max(0, preferred - 120) : 0;
    const max = hasPrevious ? Math.min(path.length, preferred + 120) : path.length;
    const hit = projectInRange(path, input.position, min, max, preferred);
    if (!Number.isFinite(hit.offset) || hit.offset > MAX_POSITION_OFFSET_METRES) {
      return empty();
    }
    anchor = hit.distance;
  }

  const anchorPoint = pointAtDistance(path, anchor);
  const positionOffset = metresBetween(anchorPoint, input.position);
  if (positionOffset > MAX_POSITION_OFFSET_METRES) {
    return empty();
  }

  const accuracy = Number.isFinite(input.accuracy) && (input.accuracy ?? 0) >= 0 ? input.accuracy! : 0;
  const referenceThreshold = Math.max(OFFSET_REFERENCE_BASE_METRES, accuracy + 5);
  const referenceJoinProgress = navigationReferenceJoinProgress({ ...input, progress: anchor }, path);
  if (referenceJoinProgress !== undefined && positionOffset > referenceThreshold) {
    const tangent = tangentAt(path, anchor);
    const forwardDistance = referenceJoinProgress - anchor;
    const referenceEnd = pointAtDistance(path, referenceJoinProgress);
    if ([...input.position, ...anchorPoint, ...referenceEnd].every(Number.isFinite)) {
      features.push({
        type: 'Feature',
        properties: { kind: 'route', role: 'offset-reference', ordinal: -3, closeView: input.cameraMode !== 'top' },
        geometry: { type: 'LineString', coordinates: offsetReference(input.position, referenceEnd, tangent, forwardDistance) },
      });
      features.push({
        type: 'Feature',
        properties: { kind: 'route', role: 'route-projection', ordinal: -2, closeView: input.cameraMode !== 'top' },
        geometry: { type: 'Point', coordinates: anchorPoint },
      });
    }
  }

  if (input.cameraMode === 'top') return empty(anchor, referenceJoinProgress);

  if (input.kind === 'route') {
    const start = referenceJoinProgress ?? anchor;
    const end = Math.min(path.length, anchor + RIBBON_LENGTH_METRES);
    if (end > start) {
      const samples = ribbonSamples(path, start, end);
      const coordinates = samples.map(({ point }) => point);
      if (coordinates.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { kind: 'route', role: 'ribbon', ordinal: -1, closeView: true },
          geometry: { type: 'LineString', coordinates },
        });
      }
    }
  }

  const remaining = path.length - anchor;
  const targetMetres = Number.isFinite(leadTargetMetres)
    ? Math.max(20, Math.min(LEAD_TARGET_METRES, leadTargetMetres))
    : LEAD_TARGET_METRES;
  const leadDistance = input.kind === 'route' && remaining >= LEAD_MIN_REMAINING_METRES
    ? anchor + Math.min(targetMetres, remaining * 0.65)
    : null;
  if (leadDistance !== null) {
    const tangent = tangentAt(path, leadDistance);
    if (tangent) {
      features.push({
        type: 'Feature',
        properties: { kind: 'route', role: 'lead', ordinal: -2, bearing: bearingOf(tangent) },
        geometry: { type: 'Point', coordinates: pointAtDistance(path, leadDistance) },
      });
    }
  }

  const maxArrows = input.kind === 'route' ? MAX_ROUTE_ARROWS : MAX_REJOIN_ARROWS;
  for (let ordinal = 0; ordinal < maxArrows; ordinal++) {
    const distance = anchor + FIRST_ARROW_METRES + ordinal * ARROW_SPACING_METRES;
    if (distance > path.length) break;
    if (leadDistance !== null && Math.abs(distance - leadDistance) <= 14) continue;
    const center = pointAtDistance(path, distance);
    const tangent = tangentAt(path, distance);
    if (!tangent) continue;
    const role = input.kind === 'route' ? 'chevron' : 'rejoin';
    features.push({
      type: 'Feature',
      properties: { kind: input.kind, role, ordinal, bearing: bearingOf(tangent) },
      geometry: { type: 'Point', coordinates: center },
    });
  }
  return empty(anchor, referenceJoinProgress);
}

/** Geometry-only convenience API for callers that do not need the projected chainage. */
export function createNavigationCueFeatures(
  input: NavigationCueInput | null,
  previousProgress?: number,
): NavigationCueFeatureCollection {
  return createNavigationCueData(input, previousProgress).data;
}
