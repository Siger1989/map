import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { TrackOverlay } from './TrackLayer.ts';
import { equalCoordinate } from './editing.ts';

type AnalysisPart = { coordinates: Coordinate[]; sourceSegment?: number };
type IndexedSample = { coordinate: Coordinate; fraction: number; a: Coordinate; b: Coordinate };
export type ProfilePreviewIndex = {
  byNode: Map<string, IndexedSample[]>;
  indexedCoordinates: number;
};

const cache = new WeakMap<object, {
  sourceSegments: Coordinate[][];
  profileSegments: Coordinate[][];
  parts: AnalysisPart[];
  index: ProfilePreviewIndex;
}>();

/** Build once for a stable analysis profile; preview frames only read the moved node's entries. */
export function profilePreviewIndex(
  sourceSegments: Coordinate[][],
  profileSegments: Coordinate[][],
  analysis: NonNullable<TrackOverlay['analysisParts']>,
): ProfilePreviewIndex | undefined {
  if (analysis.sourceSegments !== sourceSegments || !analysis.profileSegments ||
    analysis.profileSegments !== profileSegments || sourceSegments.length !== profileSegments.length) return undefined;
  const cached = cache.get(analysis);
  if (cached && cached.sourceSegments === sourceSegments && cached.profileSegments === profileSegments && cached.parts === analysis.parts)
    return cached.index;

  const byNode = new Map<string, IndexedSample[]>();
  const cursors = new Map<number, number>();
  const segmentIndexes = new Map<number, {
    source: Coordinate[]; profile: Coordinate[]; originalIndices: number[];
    cumulative: number[]; profileOwner: number[];
  }>();
  let indexedCoordinates = 0;
  for (let segment = 0; segment < sourceSegments.length; segment++) {
    const source = sourceSegments[segment], profile = profileSegments[segment];
    if (!source || !profile || source.length < 2 || profile.length < 2) continue;
    const originalIndices: number[] = [];
    let originalCursor = 0;
    for (const point of source) {
      while (originalCursor < profile.length && profile[originalCursor] !== point) originalCursor++;
      if (originalCursor >= profile.length) { originalIndices.length = 0; break; }
      originalIndices.push(originalCursor++);
    }
    if (originalIndices.length !== source.length) continue;
    const cumulative = new Array<number>(profile.length).fill(0);
    for (let i = 1; i < profile.length; i++) cumulative[i] = cumulative[i - 1] + metresBetween(profile[i - 1], profile[i]);
    const profileOwner = new Array<number>(profile.length - 1);
    let owner = 0;
    for (let i = 0; i < profileOwner.length; i++) {
      while (owner + 1 < originalIndices.length - 1 && i >= originalIndices[owner + 1]) owner++;
      profileOwner[i] = owner;
    }
    segmentIndexes.set(segment, { source, profile, originalIndices, cumulative, profileOwner });
  }
  for (const part of analysis.parts as AnalysisPart[]) {
    const segment = part.sourceSegment;
    const indexed = segmentIndexes.get(segment ?? -1);
    if (!indexed) continue;
    const { source, profile, originalIndices, cumulative, profileOwner } = indexed;
    let cursor = cursors.get(segment!) ?? 0;
    for (const point of part.coordinates) {
      let found = -1, fraction = 0;
      while (cursor < profile.length - 1) {
        const candidate = segmentFraction(point, profile[cursor], profile[cursor + 1]);
        if (candidate !== null) { found = cursor; fraction = candidate; break; }
        cursor++;
      }
      if (found < 0) {
        cursor = 0;
        continue;
      }
      const edgeIndex = profileOwner[found];
      const pathStart = originalIndices[edgeIndex], pathEnd = originalIndices[edgeIndex + 1];
      const edgeLength = cumulative[pathEnd] - cumulative[pathStart];
      const distanceBefore = cumulative[found] - cumulative[pathStart];
      const subLength = metresBetween(profile[found], profile[found + 1]);
      const along = distanceBefore + fraction * subLength;
      const routeFraction = edgeLength ? Math.max(0, Math.min(1, along / edgeLength)) : 0;
      const a = source[edgeIndex], b = source[edgeIndex + 1];
      addNodeSample(byNode, a.join(','), { coordinate: point, fraction: routeFraction, a, b });
      addNodeSample(byNode, b.join(','), { coordinate: point, fraction: routeFraction, a, b });
      indexedCoordinates++;
      cursor = found;
    }
    cursors.set(segment!, cursor);
  }
  const index = { byNode, indexedCoordinates };
  cache.set(analysis, { sourceSegments, profileSegments, parts: analysis.parts, index });
  return index;
}

export function profilePreviewMoves(index: ProfilePreviewIndex, from: Coordinate, to: Coordinate) {
  const moves = new Map<string, Coordinate>();
  for (const sample of index.byNode.get(from.join(',')) ?? []) {
    const a = equalCoordinate(sample.a, from) ? to : sample.a;
    const b = equalCoordinate(sample.b, from) ? to : sample.b;
    moves.set(sample.coordinate.join(','), interpolateCoordinate(a, b, sample.fraction));
  }
  return moves;
}

function addNodeSample(index: Map<string, IndexedSample[]>, key: string, sample: IndexedSample) {
  let values = index.get(key);
  if (!values) index.set(key, values = []);
  values.push(sample);
}

function segmentFraction(point: Coordinate, a: Coordinate, b: Coordinate): number | null {
  const bx = unwrapLongitude(b[0], a[0]), px = unwrapLongitude(point[0], a[0]);
  const dx = bx - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  if (!length2) return equalCoordinate(point, a) ? 0 : null;
  const fraction = ((px - a[0]) * dx + (point[1] - a[1]) * dy) / length2;
  if (fraction < -1e-8 || fraction > 1 + 1e-8) return null;
  const x = a[0] + dx * fraction, y = a[1] + dy * fraction;
  return Math.hypot(px - x, point[1] - y) <= 1e-9
    ? Math.max(0, Math.min(1, fraction))
    : null;
}

function interpolateCoordinate(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  const longitudeDelta = unwrapLongitude(b[0], a[0]) - a[0];
  const longitude = a[0] + longitudeDelta * fraction;
  return [((longitude + 540) % 360) - 180, a[1] + (b[1] - a[1]) * fraction];
}

function unwrapLongitude(longitude: number, origin: number) {
  return origin + (((longitude - origin + 540) % 360) - 180);
}
