import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { ScreenPoint } from './drawing';

export const SNAP_RADIUS = 14;
const SNAP_CELL_SIZE = SNAP_RADIUS;
export type SnapViewport = {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  revision?: number | string;
};
const GEO_CELL_SIZE = 0.1;
const normalizeLng = (lng: number) => ((lng % 360) + 360) % 360;

export function isValidSnapViewport(v: SnapViewport | null | undefined): v is SnapViewport {
  const longitudeSpan = v ? v.east - v.west : Number.NaN;
  return !!v && [v.west, v.south, v.east, v.north, v.width, v.height].every(Number.isFinite) &&
    v.south >= -90 && v.north <= 90 && v.south <= v.north && v.width > 0 && v.height > 0 &&
    longitudeSpan <= 360 && longitudeSpan > -360;
}

/** Geographic index over a candidate snapshot; viewport bounds already include the snap-radius margin. */
export class SnapCandidateIndex {
  private cells = new Map<string, number[]>();
  private candidates: Coordinate[];
  constructor(candidates: Coordinate[]) {
    this.candidates = candidates;
    candidates.forEach(([lng, lat], index) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90) return;
      const key = this.cellKey(normalizeLng(lng), lat);
      const cell = this.cells.get(key);
      if (cell) cell.push(index);
      else this.cells.set(key, [index]);
    });
  }
  within(viewport: SnapViewport | null | undefined): Coordinate[] {
    if (!isValidSnapViewport(viewport)) return this.candidates;
    const { west, east, south, north } = viewport;
    let span = east - west;
    if (span < 0) span += 360;
    if (span >= 360) return this.candidates;
    const start = normalizeLng(west), end = start + span;
    const intervals: [number, number][] = end < 360 ? [[start, end]] : [[start, 360], [0, end - 360]];
    const lat0 = Math.max(-90, south), lat1 = Math.min(90, north);
    const y0 = Math.floor((lat0 + 90) / GEO_CELL_SIZE), y1 = Math.floor((lat1 + 90) / GEO_CELL_SIZE);
    const xRanges = intervals.map(([x0, x1]) => [
      Math.floor(x0 / GEO_CELL_SIZE),
      Math.floor(Math.min(x1, 360 - Number.EPSILON) / GEO_CELL_SIZE),
    ] as const);
    const keyCount = xRanges.reduce((count, [x0, x1]) => count + Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1), 0);
    // A broad viewport is cheaper as a direct bounded scan. Check before
    // allocating cell-key strings; world-scale bounds span millions of cells.
    if (keyCount > 10000) return this.filterBounds(viewport);
    const keys: string[] = [];
    for (const [x0, x1] of xRanges)
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
    const indices = new Set<number>();
    for (const key of keys) for (const index of this.cells.get(key) ?? []) indices.add(index);
    return [...indices].sort((a, b) => a - b).map((index) => this.candidates[index]).filter((c) => {
      const lng = normalizeLng(c[0]);
      const inLng = intervals.some(([a, b]) => lng >= a && lng <= b);
      return inLng && c[1] >= south && c[1] <= north;
    });
  }
  private filterBounds(v: SnapViewport) {
    let span = v.east - v.west;
    if (span < 0) span += 360;
    if (span >= 360) return this.candidates;
    const start = normalizeLng(v.west), end = start + span;
    return this.candidates.filter(([lng, lat]) => {
      if (lat < v.south || lat > v.north) return false;
      const n = normalizeLng(lng);
      return end < 360 ? n >= start && n <= end : n >= start || n <= end - 360;
    });
  }
  private cellKey(lng: number, lat: number) {
    return `${Math.floor(lng / GEO_CELL_SIZE)},${Math.floor((lat + 90) / GEO_CELL_SIZE)}`;
  }
}
export function sameNode(a: Coordinate, b: Coordinate) {
  return metresBetween(a, b) < 0.15;
}
export function endpoints(segments: Coordinate[][]): Coordinate[] {
  return segments.flatMap((line) =>
    line.length ? [line[0], line.at(-1)!] : [],
  );
}
/** A continued/branched draft must reconnect to interior vertices, including
 * legacy freehand/road bends without an explicit nodes list. Keep exact values. */
export function draftSnapNodes(segments: Coordinate[][]): Coordinate[] {
  return [
    ...new Map(
      segments.flat().map((point) => [point.join(','), point]),
    ).values(),
  ];
}
export function hasLoosePoints(segments: Coordinate[][]) {
  const ends = endpoints(segments.filter((line) => line.length >= 2));
  return segments.some(
    (line) => line.length === 1 && !ends.some((p) => sameNode(p, line[0])),
  );
}
export function findSnap(
  point: ScreenPoint,
  candidates: Coordinate[],
  project: (c: Coordinate) => ScreenPoint | null,
  unproject?: (p: ScreenPoint) => Coordinate | null,
) {
  // Route forks can expose thousands of vertices as snap targets. On every
  // touch-move, reject candidates outside the geographic footprint of the
  // 14px snap circle before asking MapLibre to project them to screen space.
  let bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    centerLng: number;
  } | null = null;
  if (unproject) {
    const center = unproject(point);
    const corners = [
      unproject({ x: point.x - SNAP_RADIUS, y: point.y - SNAP_RADIUS }),
      unproject({ x: point.x + SNAP_RADIUS, y: point.y - SNAP_RADIUS }),
      unproject({ x: point.x - SNAP_RADIUS, y: point.y + SNAP_RADIUS }),
      unproject({ x: point.x + SNAP_RADIUS, y: point.y + SNAP_RADIUS }),
    ];
    if (center && corners.every((p): p is Coordinate => !!p)) {
      const longitudes = corners.map(
        ([lng]) => center[0] + ((((lng - center[0]) + 540) % 360) - 180),
      );
      bounds = {
        minLat: Math.min(...corners.map((p) => p[1])),
        maxLat: Math.max(...corners.map((p) => p[1])),
        minLng: Math.min(...longitudes),
        maxLng: Math.max(...longitudes),
        centerLng: center[0],
      };
    }
  }
  let best: { coordinate: Coordinate; screen: ScreenPoint } | null = null,
    distance = SNAP_RADIUS;
  for (const coordinate of candidates) {
    if (bounds) {
      const lng =
        bounds.centerLng +
        ((((coordinate[0] - bounds.centerLng) + 540) % 360) - 180);
      if (
        coordinate[1] < bounds.minLat ||
        coordinate[1] > bounds.maxLat ||
        lng < bounds.minLng ||
        lng > bounds.maxLng
      )
        continue;
    }
    const screen = project(coordinate);
    if (!screen) continue;
    const d = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (d <= distance) {
      best = { coordinate, screen };
      distance = d;
    }
  }
  return best;
}

/** A screen-space index whose cached projections remain valid for one camera pose. */
export class ProjectedSnapGrid {
  private cells = new Map<string, { coordinate: Coordinate; screen: ScreenPoint; order: number }[]>();
  constructor(
    candidates: Coordinate[],
    project: (c: Coordinate) => ScreenPoint | null,
    viewport?: Pick<SnapViewport, 'width' | 'height'>,
  ) {
    candidates.forEach((coordinate, order) => {
      const screen = project(coordinate);
      if (!screen) return;
      if (viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0 &&
        (screen.x < -SNAP_RADIUS || screen.x > viewport.width + SNAP_RADIUS || screen.y < -SNAP_RADIUS || screen.y > viewport.height + SNAP_RADIUS)) return;
      const key = this.cellKey(screen.x, screen.y);
      const cell = this.cells.get(key);
      const entry = { coordinate, screen, order };
      if (cell) cell.push(entry);
      else this.cells.set(key, [entry]);
    });
  }
  nearest(point: ScreenPoint) {
    const cellX = Math.floor(point.x / SNAP_CELL_SIZE);
    const cellY = Math.floor(point.y / SNAP_CELL_SIZE);
    const nearby: { coordinate: Coordinate; screen: ScreenPoint; order: number }[] = [];
    for (let x = cellX - 1; x <= cellX + 1; x++)
      for (let y = cellY - 1; y <= cellY + 1; y++)
        nearby.push(...(this.cells.get(`${x},${y}`) ?? []));
    nearby.sort((a, b) => a.order - b.order);
    let best: { coordinate: Coordinate; screen: ScreenPoint } | null = null;
    let distance = SNAP_RADIUS;
    for (const entry of nearby) {
      const d = Math.hypot(entry.screen.x - point.x, entry.screen.y - point.y);
      // Keep findSnap's <= tie rule: equal-distance later candidates win.
      if (d <= distance) {
        best = { coordinate: entry.coordinate, screen: entry.screen };
        distance = d;
      }
    }
    return best;
  }
  private cellKey(x: number, y: number) {
    return `${Math.floor(x / SNAP_CELL_SIZE)},${Math.floor(y / SNAP_CELL_SIZE)}`;
  }
}
/** Join only unambiguous endpoints. Never bridge gaps or choose a branch for the user. */
export function joinSegments(input: Coordinate[][]): Coordinate[][] {
  const lines = input
    .filter((line) => line.length >= 2)
    .map((line) => line.slice());
  const allEnds = endpoints(lines);
  const unambiguous = (point: Coordinate) =>
    allEnds.filter((p) => sameNode(point, p)).length === 2;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < lines.length; a++)
      for (let b = a + 1; b < lines.length; b++) {
        for (const reverseA of [false, true])
          for (const reverseB of [false, true]) {
            const left = reverseA ? lines[a].slice().reverse() : lines[a];
            const right = reverseB ? lines[b].slice().reverse() : lines[b];
            if (sameNode(left.at(-1)!, right[0]) && unambiguous(right[0])) {
              lines[a] = [...left, ...right.slice(1)];
              lines.splice(b, 1);
              changed = true;
              break outer;
            }
          }
      }
  }
  return lines;
}
export function connectedTracks<
  T extends { id: string; segments: Coordinate[][] },
>(seed: T, tracks: T[]): T[] {
  const connected = [seed];
  let changed = true;
  while (changed) {
    changed = false;
    for (const track of tracks) {
      if (connected.some((t) => t.id === track.id)) continue;
      const ends = endpoints(connected.flatMap((t) => t.segments));
      if (
        endpoints(track.segments).some((p) =>
          ends.some((end) => sameNode(p, end)),
        )
      ) {
        connected.push(track);
        changed = true;
      }
    }
  }
  return connected;
}

/** Connection copies can contain source edges again. Count each physical edge once
 * before checking junction degree; real branches and gaps remain separate. */
export function joinUniqueSegments(input: Coordinate[][]): Coordinate[][] {
  const seen = new Set<string>();
  const runs: Coordinate[][] = [];
  for (const line of input) {
    let run: Coordinate[] = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i];
      if (sameNode(a, b)) continue;
      const key = [a.join(','), b.join(',')].sort().join('|');
      if (seen.has(key)) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      seen.add(key);
      if (!run.length) run.push(a);
      run.push(b);
    }
    if (run.length > 1) runs.push(run);
  }
  const joined = joinSegments(runs);
  const vertices = joined.flat();
  return [
    ...joined,
    ...input.filter(
      (line) =>
        line.length === 1 && !vertices.some((p) => sameNode(p, line[0])),
    ),
  ];
}
