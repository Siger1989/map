import type { Feature, FeatureCollection, LineString } from 'geojson';
import { coordinate, type Coordinate, metresBetween } from '../navigation/types.ts';
import { pathOf, type Path } from './geometry.ts';

export type NavigationCueInput = {
  coordinates: Coordinate[];
  position: Coordinate;
  progress?: number;
  kind: 'route' | 'rejoin';
};

export type NavigationCueFeatureCollection = FeatureCollection<LineString, {
  kind: NavigationCueInput['kind'];
  ordinal: number;
}>;
export type NavigationCueResult = { data: NavigationCueFeatureCollection; progress?: number };

const MAX_ARROWS = 5;
const FIRST_ARROW_METRES = 20;
const ARROW_SPACING_METRES = 38;
const ARROW_WING_METRES = 5;
const ARROW_BACK_METRES = 6;
const ARROW_TIP_METRES = 5;
const MAX_POSITION_OFFSET_METRES = 100;

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

function moveMetres(origin: Coordinate, east: number, north: number): Coordinate {
  const latitude = Math.max(-85, Math.min(85, origin[1]));
  const latitudeRadians = latitude * Math.PI / 180;
  const longitude = origin[0] + east / (111_320 * Math.max(0.01, Math.cos(latitudeRadians)));
  return [((longitude + 540) % 360) - 180, origin[1] + north / 111_320];
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

/** Build a bounded set of forward-facing chevrons along route chainage. */
export function createNavigationCueData(
  input: NavigationCueInput | null,
  previousProgress?: number,
  resolvedPath?: Path | null,
): NavigationCueResult {
  const features: NavigationCueFeatureCollection['features'] = [];
  const empty = (progress?: number): NavigationCueResult => ({
    data: { type: 'FeatureCollection', features }, progress,
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
  if (metresBetween(anchorPoint, input.position) > MAX_POSITION_OFFSET_METRES) {
    return empty();
  }

  for (let ordinal = 0; ordinal < MAX_ARROWS; ordinal++) {
    const distance = anchor + FIRST_ARROW_METRES + ordinal * ARROW_SPACING_METRES;
    if (distance > path.length) break;
    const center = pointAtDistance(path, distance);
    const tangent = tangentAt(path, distance);
    if (!tangent) continue;
    const left = { east: -tangent.north, north: tangent.east };
    const tail = moveMetres(center,
      -tangent.east * ARROW_BACK_METRES + left.east * ARROW_WING_METRES,
      -tangent.north * ARROW_BACK_METRES + left.north * ARROW_WING_METRES);
    const tip = moveMetres(center, tangent.east * ARROW_TIP_METRES, tangent.north * ARROW_TIP_METRES);
    const otherTail = moveMetres(center,
      -tangent.east * ARROW_BACK_METRES - left.east * ARROW_WING_METRES,
      -tangent.north * ARROW_BACK_METRES - left.north * ARROW_WING_METRES);
    features.push({
      type: 'Feature',
      properties: { kind: input.kind, ordinal },
      geometry: { type: 'LineString', coordinates: [tail, tip, otherTail] },
    });
  }
  return empty(anchor);
}

/** Geometry-only convenience API for callers that do not need the projected chainage. */
export function createNavigationCueFeatures(
  input: NavigationCueInput | null,
  previousProgress?: number,
): NavigationCueFeatureCollection {
  return createNavigationCueData(input, previousProgress).data;
}
