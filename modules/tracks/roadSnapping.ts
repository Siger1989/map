import { coordinate, type Coordinate } from '../navigation/types.ts';
import type { ScreenPoint } from './drawing';

export const ROAD_SNAP_RADIUS = 14;
export const ROAD_RELEASE_RADIUS = 22;
export type RoadLine = { id: string; name: string; coordinates: Coordinate[] };
export type RoadMatch = {
  line: RoadLine;
  index: number;
  fraction: number;
  coordinate: Coordinate;
  screen: ScreenPoint;
};
export type RoadSnapResult = {
  match: RoadMatch | null;
  status: 'ready' | 'zoom' | 'hidden' | 'loading' | 'unavailable';
};
export type RoadSnapper = (
  point: ScreenPoint,
  previous: RoadMatch | null,
) => RoadSnapResult;
type Project = (point: Coordinate) => ScreenPoint | null;
const classes = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'track',
  'path',
  'steps',
  'pedestrian',
]);

/** Read road geometry, never labels, rivers, railways or the user's own ink. */
export function roadLines(
  features: {
    properties?: Record<string, unknown> | null;
    geometry: unknown;
  }[],
): RoadLine[] {
  const lines = new Map<string, RoadLine>();
  let count = 0;
  for (const feature of features) {
    if (!classes.has(String(feature.properties?.class))) continue;
    const geometry = feature.geometry as {
      type?: string;
      coordinates?: unknown;
    } | null;
    const parts =
      geometry?.type === 'LineString'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiLineString'
          ? geometry.coordinates
          : [];
    if (!Array.isArray(parts)) continue;
    for (const points of parts) {
      if (
        !Array.isArray(points) ||
        points.length < 2 ||
        !points.every(coordinate)
      )
        continue;
      if (count + points.length > 6000) continue;
      const id = points.map((p) => p.join(',')).join(';');
      if (lines.has(id)) continue;
      count += points.length;
      const rawName =
        feature.properties?.['name:zh'] ?? feature.properties?.name;
      lines.set(id, {
        id,
        coordinates: points,
        name: typeof rawName === 'string' ? rawName.slice(0, 60) : '',
      });
    }
  }
  return [...lines.values()];
}

function interpolate(
  a: Coordinate,
  b: Coordinate,
  fraction: number,
): Coordinate {
  // Road tile geometry consists of straight segments in Web Mercator.
  const mercator = (lat: number) => Math.asinh(Math.tan((lat * Math.PI) / 180));
  return [
    a[0] + (b[0] - a[0]) * fraction,
    (Math.atan(
      Math.sinh(mercator(a[1]) + (mercator(b[1]) - mercator(a[1])) * fraction),
    ) *
      180) /
      Math.PI,
  ];
}
const finite = (p: ScreenPoint | null): p is ScreenPoint =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Screen-space tolerance stays usable while zooming and tilting the map. */
export function nearestRoad(
  point: ScreenPoint,
  lines: RoadLine[],
  project: Project,
  previous: RoadMatch | null = null,
): RoadMatch | null {
  let best: RoadMatch | null = null,
    score = Infinity;
  for (const line of lines) {
    const locked = line.id === previous?.line.id;
    const radius = locked ? ROAD_RELEASE_RADIUS : ROAD_SNAP_RADIUS;
    for (let index = 0; index < line.coordinates.length - 1; index++) {
      const a = line.coordinates[index],
        b = line.coordinates[index + 1];
      const sa = project(a),
        sb = project(b);
      if (!finite(sa) || !finite(sb)) continue;
      if (
        point.x < Math.min(sa.x, sb.x) - radius ||
        point.x > Math.max(sa.x, sb.x) + radius ||
        point.y < Math.min(sa.y, sb.y) - radius ||
        point.y > Math.max(sa.y, sb.y) + radius
      )
        continue;
      const dx = sb.x - sa.x,
        dy = sb.y - sa.y;
      if (dx * dx + dy * dy < 0.01) continue;
      // Refine the geographic fraction after projection: pitched maps are not affine.
      let low = 0,
        high = 1;
      const distance = (t: number) => {
        const screen = project(interpolate(a, b, t));
        return finite(screen)
          ? Math.hypot(screen.x - point.x, screen.y - point.y)
          : Infinity;
      };
      for (let iteration = 0; iteration < 18; iteration++) {
        const left = low + (high - low) / 3,
          right = high - (high - low) / 3;
        if (distance(left) < distance(right)) high = right;
        else low = left;
      }
      const fractions = [0, 1, (low + high) / 2];
      const fraction = fractions.reduce((best, t) =>
        distance(t) < distance(best) ? t : best,
      );
      const position =
        fraction === 0 ? a : fraction === 1 ? b : interpolate(a, b, fraction);
      const screen = project(position);
      if (!finite(screen)) continue;
      const d = Math.hypot(screen.x - point.x, screen.y - point.y);
      const candidateScore = d * (locked ? 0.8 : 1);
      if (d <= radius && candidateScore < score) {
        score = candidateScore;
        best = { line, index, fraction, coordinate: position, screen };
      }
    }
  }
  return best;
}

/** Preserve intervening bends instead of cutting across a curved road. */
export function roadSection(
  previous: RoadMatch,
  next: RoadMatch,
  project: Project,
): Coordinate[] | null {
  if (previous.line.id !== next.line.id) return null;
  const from = previous.index + previous.fraction,
    to = next.index + next.fraction;
  const points: Coordinate[] = [];
  if (to >= from) {
    for (let i = Math.floor(from) + 1; i < to; i++)
      points.push(next.line.coordinates[i]);
  } else {
    for (let i = Math.ceil(from) - 1; i > to; i--)
      points.push(next.line.coordinates[i]);
  }
  points.push(next.coordinate);
  if (points.length > 128) return null;
  let distance = 0,
    last = previous.screen;
  for (const point of points) {
    const screen = project(point);
    if (!finite(screen)) return null;
    distance += Math.hypot(screen.x - last.x, screen.y - last.y);
    last = screen;
  }
  // A nearby hairpin or disconnected tile must not send ink on a large detour.
  if (
    distance >
    Math.hypot(
      next.screen.x - previous.screen.x,
      next.screen.y - previous.screen.y,
    ) *
      4 +
      32
  )
    return null;
  return points;
}

export function roadHint(result: RoadSnapResult) {
  if (result.match)
    return result.match.line.name
      ? `已吸附道路 · ${result.match.line.name}`
      : '已吸附道路 / 小路';
  return {
    ready: '附近没有可吸附道路 · 自由绘制',
    zoom: '请放大地图以加载道路和山间小路',
    hidden: '开启“道路与河流”后可吸附地图道路',
    loading: '道路数据加载中 · 暂按自由线绘制',
    unavailable: '道路数据不可用 · 暂按自由线绘制',
  }[result.status];
}
