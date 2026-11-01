import { coordinate, metresBetween, type Coordinate } from '../navigation/types.ts';
import type { RoadLine, RoadMatch } from './roadSnapping.ts';
import { MAX_ROAD_PATH_INPUT_POINTS } from './roadPath.ts';

/** Keep this fast path bounded independently from the full network builder. */
const MAX_SNAPSHOT_POINTS = 6000;
const MAX_VERTEX_PAIR_CANDIDATES = 1024;
const MATCH_ON_SOURCE_TOLERANCE_METRES = 0.05;

type LineVertexIndex = {
  readonly coordinates: Coordinate[];
  readonly snapshot: Float64Array;
  readonly cumulativeMetres: Float64Array;
  readonly indicesByLongitude: Map<number, Map<number, number[]>>;
};

const vertexIndices = new WeakMap<RoadLine, LineVertexIndex>();

function addVertexIndex(
  index: Map<number, Map<number, number[]>>,
  point: Coordinate,
  vertex: number,
): void {
  let latitudes = index.get(point[0]);
  if (!latitudes) index.set(point[0], (latitudes = new Map()));
  let occurrences = latitudes.get(point[1]);
  if (!occurrences) latitudes.set(point[1], (occurrences = []));
  occurrences.push(vertex);
}

function findVertexIndices(
  index: LineVertexIndex,
  point: Coordinate,
): readonly number[] | undefined {
  return index.indicesByLongitude.get(point[0])?.get(point[1]);
}

function isCurrent(index: LineVertexIndex, line: RoadLine): boolean {
  const coordinates = line.coordinates;
  if (coordinates !== index.coordinates || coordinates.length * 2 !== index.snapshot.length) return false;
  for (let i = 0; i < coordinates.length; i++) {
    const point = coordinates[i];
    if (
      !coordinate(point) ||
      point[0] !== index.snapshot[i * 2] ||
      point[1] !== index.snapshot[i * 2 + 1]
    ) return false;
  }
  return true;
}

function getVertexIndex(line: RoadLine): LineVertexIndex | null {
  const cached = vertexIndices.get(line);
  if (cached && isCurrent(cached, line)) return cached;

  const coordinates = line.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const snapshot = new Float64Array(coordinates.length * 2);
  const cumulativeMetres = new Float64Array(coordinates.length);
  const indicesByLongitude = new Map<number, Map<number, number[]>>();

  for (let i = 0; i < coordinates.length; i++) {
    const point = coordinates[i];
    if (!coordinate(point)) return null;
    snapshot[i * 2] = point[0];
    snapshot[i * 2 + 1] = point[1];
    addVertexIndex(indicesByLongitude, point, i);
    if (i > 0) {
      const length = metresBetween(coordinates[i - 1], point);
      if (!Number.isFinite(length)) return null;
      cumulativeMetres[i] = cumulativeMetres[i - 1] + length;
    }
  }

  const result = { coordinates, snapshot, cumulativeMetres, indicesByLongitude };
  vertexIndices.set(line, result);
  return result;
}

function interpolateMercator(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  const mercator = (latitude: number) => Math.asinh(Math.tan((latitude * Math.PI) / 180));
  return [
    a[0] + (b[0] - a[0]) * fraction,
    Math.atan(
      Math.sinh(mercator(a[1]) + (mercator(b[1]) - mercator(a[1])) * fraction),
    ) * 180 / Math.PI,
  ];
}

function matchPosition(match: RoadMatch, index: LineVertexIndex): number | null {
  const { coordinates } = index;
  if (
    !Number.isInteger(match.index) ||
    match.index < 0 ||
    match.index >= coordinates.length - 1 ||
    !Number.isFinite(match.fraction) ||
    match.fraction < 0 ||
    match.fraction > 1 ||
    !coordinate(match.coordinate)
  ) return null;

  const expected = interpolateMercator(
    coordinates[match.index],
    coordinates[match.index + 1],
    match.fraction,
  );
  if (metresBetween(expected, match.coordinate) > MATCH_ON_SOURCE_TOLERANCE_METRES) return null;
  return match.index + match.fraction;
}

function positionMetres(match: RoadMatch, index: LineVertexIndex): number | null {
  const position = matchPosition(match, index);
  if (position === null) return null;
  const base = Math.floor(position);
  return index.cumulativeMetres[base] + metresBetween(
    index.coordinates[base],
    match.coordinate,
  );
}

function append(output: Coordinate[], point: Coordinate): boolean {
  output.push(point);
  return output.length <= MAX_ROAD_PATH_INPUT_POINTS;
}

function appendFromToVertex(
  output: Coordinate[],
  coordinates: Coordinate[],
  fromPosition: number,
  vertex: number,
): boolean {
  if (vertex > fromPosition) {
    for (let i = Math.floor(fromPosition) + 1; i <= vertex; i++) {
      if (!append(output, coordinates[i])) return false;
    }
  } else if (vertex < fromPosition) {
    for (let i = Math.ceil(fromPosition) - 1; i >= vertex; i--) {
      if (!append(output, coordinates[i])) return false;
    }
  }
  return true;
}

function appendVertexToToMatch(
  output: Coordinate[],
  coordinates: Coordinate[],
  vertex: number,
  toPosition: number,
  toMatch: Coordinate,
): boolean {
  if (toPosition > vertex) {
    for (let i = vertex + 1; i < toPosition; i++) {
      if (!append(output, coordinates[i])) return false;
    }
  } else if (toPosition < vertex) {
    for (let i = vertex - 1; i > toPosition; i--) {
      if (!append(output, coordinates[i])) return false;
    }
  }
  return append(output, toMatch);
}

function snapshotPointCount(lines: ReadonlyMap<string, RoadLine>): number | null {
  // RoadLine snapshots are built from features with at least two points. This
  // map-size bound also protects malformed inputs full of empty arrays.
  if (lines.size > MAX_SNAPSHOT_POINTS / 2) return null;
  let count = 0;
  for (const [id, line] of lines) {
    if (id !== line.id || !Array.isArray(line.coordinates)) return null;
    count += line.coordinates.length;
    if (count > MAX_SNAPSHOT_POINTS) return null;
  }
  return count;
}

/**
 * Follow two current, same-level road features through an exact shared source
 * vertex. This only traces their existing polylines; it never inserts a
 * connector between distinct coordinates.
 */
export function directSharedVertexRoadSection(
  from: RoadMatch,
  to: RoadMatch,
  currentLines: ReadonlyMap<string, RoadLine>,
): Coordinate[] | null {
  if (
    !from || !to ||
    from.line.id === to.line.id ||
    !Number.isFinite(from.line.level) ||
    from.line.level !== to.line.level ||
    currentLines.get(from.line.id) !== from.line ||
    currentLines.get(to.line.id) !== to.line ||
    snapshotPointCount(currentLines) === null
  ) return null;

  const fromIndex = getVertexIndex(from.line);
  const toIndex = getVertexIndex(to.line);
  if (!fromIndex || !toIndex) return null;
  const fromPosition = matchPosition(from, fromIndex);
  const toPosition = matchPosition(to, toIndex);
  const fromMetres = positionMetres(from, fromIndex);
  const toMetres = positionMetres(to, toIndex);
  if (fromPosition === null || toPosition === null || fromMetres === null || toMetres === null) return null;

  let candidatePairs = 0;
  let bestFromVertex = -1;
  let bestToVertex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < fromIndex.coordinates.length; i++) {
    const matches = findVertexIndices(toIndex, fromIndex.coordinates[i]);
    if (!matches) continue;
    candidatePairs += matches.length;
    if (candidatePairs > MAX_VERTEX_PAIR_CANDIDATES) return null;
    for (const j of matches) {
      const distance = Math.abs(fromIndex.cumulativeMetres[i] - fromMetres) +
        Math.abs(toIndex.cumulativeMetres[j] - toMetres);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFromVertex = i;
        bestToVertex = j;
      }
    }
  }
  if (bestFromVertex < 0) return null;

  const output: Coordinate[] = [];
  if (!appendFromToVertex(
    output,
    fromIndex.coordinates,
    fromPosition,
    bestFromVertex,
  )) return null;
  if (!appendVertexToToMatch(
    output,
    toIndex.coordinates,
    bestToVertex,
    toPosition,
    to.coordinate,
  )) return null;
  return output;
}
