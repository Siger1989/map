import { DEFAULT_TRACK_STYLE } from '../tracks/style.ts';

/** Each route point is [west to east, north to south], normalized to the rectangular selection. */
export type TerrainPrintTracks = readonly (readonly (readonly [number, number])[])[];

const TRACK_RADIUS_MM = 0.7;
const TRACK_HEIGHT_MM = 0.8;
const CREST_RADIUS_MM = TRACK_RADIUS_MM * 0.45;
const COLORED_FACE_MAX_VERTEX_DISTANCE_MM = (TRACK_RADIUS_MM + CREST_RADIUS_MM) / 2;
const MAX_RELIEF_EDGE_MM = 0.46;
const MAX_STL_TRIANGLES = Math.floor((32 * 1024 * 1024 - 84) / 50);
// The STL face budget keeps vertex indices well below this exact-integer stride.
const EDGE_STRIDE = 1_048_576;

type Bounds = { left: number; bottom: number; right: number; top: number };
type Segment = Bounds & { x: number; y: number; dx: number; dy: number; track: number };
type SegmentIndex = Bounds & ({ segments: Segment[] } | { first: SegmentIndex; second: SegmentIndex });

function indexSegments(segments: Segment[]): SegmentIndex {
  const bounds = { left: Infinity, bottom: Infinity, right: -Infinity, top: -Infinity };
  for (const segment of segments) {
    bounds.left = Math.min(bounds.left, segment.left);
    bounds.bottom = Math.min(bounds.bottom, segment.bottom);
    bounds.right = Math.max(bounds.right, segment.right);
    bounds.top = Math.max(bounds.top, segment.top);
  }
  if (segments.length <= 8) return { ...bounds, segments };
  const splitX = bounds.right - bounds.left >= bounds.top - bounds.bottom;
  segments.sort(splitX
    ? (a, b) => a.left + a.right - b.left - b.right
    : (a, b) => a.bottom + a.top - b.bottom - b.top);
  const middle = Math.floor(segments.length / 2);
  return { ...bounds, first: indexSegments(segments.slice(0, middle)), second: indexSegments(segments.slice(middle)) };
}

function trackIndex(tracks: TerrainPrintTracks, width: number, depth: number) {
  const segments: Segment[] = [];
  for (const [trackNumber, track] of tracks.entries()) {
    for (let i = 1; i < track.length; i++) {
      const [ax, ay] = track[i - 1];
      const [bx, by] = track[i];
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const x = (ax - 0.5) * width, y = (0.5 - ay) * depth;
      const dx = (bx - ax) * width, dy = (ay - by) * depth;
      if (dx === 0 && dy === 0) continue;
      segments.push({
        x, y, dx, dy, track: trackNumber,
        left: Math.min(x, x + dx), right: Math.max(x, x + dx),
        bottom: Math.min(y, y + dy), top: Math.max(y, y + dy),
      });
    }
  }
  return segments.length > 0 ? indexSegments(segments) : null;
}

function overlaps(a: Bounds, b: Bounds) {
  return a.left <= b.right && a.right >= b.left && a.bottom <= b.top && a.top >= b.bottom;
}

/** Clip the parametric segment to both slabs of the query rectangle. */
function crosses(bounds: Bounds, segment: Segment) {
  if (!overlaps(bounds, segment)) return false;
  const { x, y, dx, dy } = segment;
  const x1 = dx === 0 ? -Infinity : (bounds.left - x) / dx;
  const x2 = dx === 0 ? Infinity : (bounds.right - x) / dx;
  const y1 = dy === 0 ? -Infinity : (bounds.bottom - y) / dy;
  const y2 = dy === 0 ? Infinity : (bounds.top - y) / dy;
  return Math.max(0, Math.min(x1, x2), Math.min(y1, y2)) <= Math.min(1, Math.max(x1, x2), Math.max(y1, y2));
}

function hasTrack(index: SegmentIndex, bounds: Bounds): boolean {
  if (!overlaps(index, bounds)) return false;
  return 'segments' in index
    ? index.segments.some(segment => crosses(bounds, segment))
    : hasTrack(index.first, bounds) || hasTrack(index.second, bounds);
}

type ClosestTrack = { index: number };

function trackDistanceSquared(index: SegmentIndex, x: number, y: number, best: number, closest?: ClosestTrack): number {
  const dxBox = Math.max(index.left - x, 0, x - index.right);
  const dyBox = Math.max(index.bottom - y, 0, y - index.top);
  if (dxBox * dxBox + dyBox * dyBox >= best) return best;
  if (!('segments' in index)) {
    const firstDistance = trackDistanceSquared(index.first, x, y, best, closest);
    return trackDistanceSquared(index.second, x, y, firstDistance, closest);
  }
  for (const segment of index.segments) {
    const dx = x - segment.x, dy = y - segment.y;
    const t = Math.max(0, Math.min(1, (dx * segment.dx + dy * segment.dy) / (segment.dx ** 2 + segment.dy ** 2)));
    const distance = (dx - t * segment.dx) ** 2 + (dy - t * segment.dy) ** 2;
    if (distance < best) {
      best = distance;
      if (closest) closest.index = segment.track;
    }
  }
  return best;
}

export function normalizeTerrainTrackColor(color: unknown): string {
  const candidate = typeof color === 'string' ? color.trim().toLowerCase() : '';
  if (/^#[0-9a-f]{6}$/.test(candidate)) return candidate;
  if (/^#[0-9a-f]{3}$/.test(candidate)) {
    return '#' + [...candidate.slice(1)].map(digit => digit + digit).join('');
  }
  return DEFAULT_TRACK_STYLE.color;
}

/** The internal STL facet attribute stores an index into this exact, ordered color palette. */
export function terrainTrackPalette(trackColors: readonly string[]): string[] {
  const palette = new Set<string>();
  for (const color of trackColors) palette.add(normalizeTerrainTrackColor(color));
  palette.add(DEFAULT_TRACK_STYLE.color);
  if (palette.size > 0x8000) throw new Error('模型轨迹颜色过多，请减少选区内的轨迹。');
  return [...palette];
}

function edgeKey(a: number, b: number) {
  return Math.min(a, b) * EDGE_STRIDE + Math.max(a, b);
}

/** Refine only the surface near the tracks, sharing every split edge with its neighbours. */
export function raiseTerrainTracks(
  positions: Float32Array, width: number, height: number, perimeter: number[], tracks: TerrainPrintTracks,
  selectionWidthMm: number, selectionDepthMm: number, withRim: boolean, trackColors?: readonly string[],
) {
  const index = trackIndex(tracks, selectionWidthMm, selectionDepthMm);
  if (!index) return null;

  const baseCount = width * height;
  const extra: number[] = [];
  const component = (vertex: number, axis: number) => vertex < baseCount
    ? positions[3 * vertex + axis]
    : extra[3 * (vertex - baseCount) + axis];
  let triangles = new Uint32Array(6 * (width - 1) * (height - 1));
  for (let row = 0, offset = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++, offset += 6) {
      const nw = row * width + col, sw = nw + width;
      triangles[offset] = nw;
      triangles[offset + 1] = sw;
      triangles[offset + 2] = nw + 1;
      triangles[offset + 3] = nw + 1;
      triangles[offset + 4] = sw;
      triangles[offset + 5] = sw + 1;
    }
  }

  for (;;) {
    const splits = new Map<number, number>();
    const mark = (a: number, b: number) => {
      if (Math.hypot(component(a, 0) - component(b, 0), component(a, 1) - component(b, 1)) <= MAX_RELIEF_EDGE_MM) return;
      const key = edgeKey(a, b);
      if (splits.has(key)) return;
      splits.set(key, baseCount + extra.length / 3);
      for (let axis = 0; axis < 3; axis++) extra.push((component(a, axis) + component(b, axis)) / 2);
    };
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      const ax = component(a, 0), bx = component(b, 0), cx = component(c, 0);
      const ay = component(a, 1), by = component(b, 1), cy = component(c, 1);
      const bounds = {
        left: Math.min(ax, bx, cx) - TRACK_RADIUS_MM, right: Math.max(ax, bx, cx) + TRACK_RADIUS_MM,
        bottom: Math.min(ay, by, cy) - TRACK_RADIUS_MM, top: Math.max(ay, by, cy) + TRACK_RADIUS_MM,
      };
      if (!hasTrack(index, bounds)) continue;
      mark(a, b);
      mark(b, c);
      mark(c, a);
    }
    if (splits.size === 0) break;
    const nextPerimeter: number[] = [];
    let boundarySplits = 0;
    for (let i = 0; i < perimeter.length; i++) {
      nextPerimeter.push(perimeter[i]);
      const middle = splits.get(edgeKey(perimeter[i], perimeter[(i + 1) % perimeter.length]));
      if (middle !== undefined) {
        nextPerimeter.push(middle);
        boundarySplits++;
      }
    }
    const faceCount = triangles.length / 3 + 2 * splits.size - boundarySplits;
    if (faceCount + nextPerimeter.length * (withRim ? 7 : 3) > MAX_STL_TRIANGLES) {
      throw new Error('选区内的立体轨迹过于密集，请缩小范围或减少可见轨迹。');
    }

    const next = new Uint32Array(3 * faceCount);
    let offset = 0;
    const triangle = (a: number, b: number, c: number) => {
      next[offset++] = a;
      next[offset++] = b;
      next[offset++] = c;
    };
    for (let i = 0; i < triangles.length; i += 3) {
      let a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      let ab = splits.get(edgeKey(a, b)), bc = splits.get(edgeKey(b, c)), ca = splits.get(edgeKey(c, a));
      const count = Number(ab !== undefined) + Number(bc !== undefined) + Number(ca !== undefined);
      if (count === 3) {
        triangle(a, ab!, ca!);
        triangle(ab!, b, bc!);
        triangle(ca!, bc!, c);
        triangle(ab!, bc!, ca!);
      } else if (count === 0) {
        triangle(a, b, c);
      } else {
        // Rotate cyclically so the split edge(s) start at ab. Cyclic shifts preserve winding.
        while (ab === undefined || (count === 2 && bc === undefined)) {
          [a, b, c] = [b, c, a];
          [ab, bc, ca] = [bc, ca, ab];
        }
        triangle(a, ab, c);
        if (bc === undefined) {
          triangle(ab, b, c);
        } else {
          triangle(ab, b, bc);
          triangle(ab, bc, c);
        }
      }
    }
    perimeter = nextPerimeter;
    triangles = next;
  }

  const vertexCount = baseCount + extra.length / 3;
  const refined = new Float32Array(3 * (vertexCount + perimeter.length * (withRim ? 3 : 1) + 1));
  refined.set(positions.subarray(0, 3 * baseCount));
  refined.set(extra, 3 * baseCount);
  const radiusSquared = TRACK_RADIUS_MM ** 2;
  const colorEligible = trackColors ? new Uint8Array(vertexCount) : undefined;
  let hasRelief = false;
  for (let i = 0; i < vertexCount; i++) {
    const distance = Math.sqrt(trackDistanceSquared(index, refined[i * 3], refined[i * 3 + 1], radiusSquared));
    if (distance >= TRACK_RADIUS_MM) continue;
    // Keep a flat printable ridge crest and bevel its shoulders into the surrounding terrain.
    refined[i * 3 + 2] += TRACK_HEIGHT_MM * Math.min(1, (TRACK_RADIUS_MM - distance) / (TRACK_RADIUS_MM - CREST_RADIUS_MM));
    if (colorEligible && distance <= COLORED_FACE_MAX_VERTEX_DISTANCE_MM) colorEligible[i] = 1;
    hasRelief = true;
  }
  if (!hasRelief) return null;

  let faceColors: Uint16Array | undefined;
  if (trackColors && colorEligible) {
    const palette = terrainTrackPalette(trackColors);
    const attributes = new Map(palette.map((color, i) => [color, 0x8000 | i]));
    const trackAttributes = tracks.map((_, i) => attributes.get(normalizeTerrainTrackColor(trackColors[i])) ?? 0);
    faceColors = new Uint16Array(triangles.length / 3);
    const closest = { index: -1 };
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      if (!(colorEligible[a] && colorEligible[b] && colorEligible[c])) continue;
      const x = (refined[a * 3] + refined[b * 3] + refined[c * 3]) / 3;
      const y = (refined[a * 3 + 1] + refined[b * 3 + 1] + refined[c * 3 + 1]) / 3;
      closest.index = -1;
      trackDistanceSquared(index, x, y, CREST_RADIUS_MM ** 2, closest);
      if (closest.index !== -1) faceColors[i / 3] = trackAttributes[closest.index];
    }
  }
  return { positions: refined, triangles, perimeter, vertexCount, faceColors };
}
