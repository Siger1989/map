import type { PrintSelection } from './selection';
import { selectionGroundSize } from './groundSize.ts';

type TrackPoint = readonly [number, number];
/** Position from west to east and north to south in the selected bounds. */
export type PrintTrack = readonly TrackPoint[];

type Interval = readonly [number, number];

function clipRectangle(x: number, y: number, dx: number, dy: number): Interval | null {
  let first = 0;
  let last = 1;
  for (const [origin, delta] of [[x, dx], [y, dy]]) {
    if (delta === 0) {
      if (origin < 0 || origin > 1) return null;
      continue;
    }
    const near = -origin / delta;
    const far = (1 - origin) / delta;
    first = Math.max(first, Math.min(near, far));
    last = Math.min(last, Math.max(near, far));
    if (first >= last) return null;
  }
  return [first, last];
}

function clipCircle(x: number, y: number, dx: number, dy: number, interval: Interval,
  radiusX: number, radiusY: number): Interval | null {
  const [first, last] = interval;
  const span = last - first;
  const px = (x + dx * first - 0.5) / radiusX;
  const py = (y + dy * first - 0.5) / radiusY;
  const vx = dx * span / radiusX;
  const vy = dy * span / radiusY;
  const lengthSquared = vx * vx + vy * vy;
  if (!lengthSquared) return null;
  // Intersect the segment with the unit disk after transforming from model dimensions.
  const nearest = -(px * vx + py * vy) / lengthSquared;
  const distanceSquared = (px + vx * nearest) ** 2 + (py + vy * nearest) ** 2;
  if (distanceSquared >= 1) return null;
  const half = Math.sqrt((1 - distanceSquared) / lengthSquared);
  const lo = Math.max(0, nearest - half);
  const hi = Math.min(1, nearest + half);
  return lo < hi ? [first + lo * span, first + hi * span] : null;
}

function validPoint(point: TrackPoint) {
  return Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
    Number.isFinite(point[1]) && Math.abs(point[1]) <= 90;
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

/** Clips each contiguous track independently, then places it in the terrain grid's coordinate system. */
export function selectPrintTracks(selection: PrintSelection, paths: readonly (readonly TrackPoint[])[]): PrintTrack[] {
  const result: TrackPoint[][] = [];
  const { west, east, south, north } = selection.bounds;
  const longitudeSpan = east - west;
  const latitudeSpan = north - south;
  if (!Number.isFinite(longitudeSpan) || longitudeSpan <= 0 || longitudeSpan >= 180 ||
      !Number.isFinite(latitudeSpan) || latitudeSpan <= 0) return result;

  const longitudeCenter = (west + east) / 2;
  const ground = selectionGroundSize(selection);
  const radius = Math.min(ground.width, ground.height) / 2;
  const radiusX = radius / ground.width;
  const radiusY = radius / ground.height;
  for (const path of paths) {
    let line: TrackPoint[] | null = null;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      if (!validPoint(from) || !validPoint(to)) {
        line = null;
        continue;
      }

      const longitudeDelta = to[0] - from[0];
      const shortDelta = longitudeDelta - 360 * Math.round(longitudeDelta / 360);
      const latitudeDelta = from[1] - to[1];
      if (!shortDelta && !latitudeDelta) continue;
      const wrap = Math.round((longitudeCenter - (from[0] + shortDelta / 2)) / 360);
      const x = (from[0] + 360 * wrap - west) / longitudeSpan;
      const y = (north - from[1]) / latitudeSpan;
      const dx = shortDelta / longitudeSpan;
      const dy = latitudeDelta / latitudeSpan;

      let interval = clipRectangle(x, y, dx, dy);
      if (interval && selection.shape === 'circle') interval = clipCircle(x, y, dx, dy, interval, radiusX, radiusY);
      if (!interval) {
        line = null;
        continue;
      }

      const [first, last] = interval;
      const start: TrackPoint = [clampUnit(x + first * dx), clampUnit(y + first * dy)];
      const end: TrackPoint = [clampUnit(x + last * dx), clampUnit(y + last * dy)];
      if (start[0] === end[0] && start[1] === end[1]) continue;

      const prev = line?.at(-1);
      if (line && prev && first <= 1e-10 && Math.abs(prev[0] - start[0]) < 1e-10 && Math.abs(prev[1] - start[1]) < 1e-10) {
        line.push(end);
      } else {
        line = [start, end];
        result.push(line);
      }
      if (last < 1 - 1e-10) line = null;
    }
  }
  return result;
}
