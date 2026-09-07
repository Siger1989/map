import {
  coordinate,
  metresBetween,
  type Coordinate,
  type PlannedRoute,
} from '../navigation/types.ts';

export type Path = {
  points: Coordinate[];
  cumulative: number[];
  length: number;
};
export type Projection = {
  point: Coordinate;
  distance: number;
  offset: number;
};
const delta = (a: number, b: number) => ((b - a + 540) % 360) - 180;
const interpolate = (a: Coordinate, b: Coordinate, t: number): Coordinate => [
  ((a[0] + delta(a[0], b[0]) * t + 540) % 360) - 180,
  a[1] + (b[1] - a[1]) * t,
];
export function pathOf(points: Coordinate[]): Path {
  if (points.length < 2 || !points.every(coordinate))
    throw new Error('路线坐标无效，请重新规划。');
  const cumulative = [0];
  for (let i = 1; i < points.length; i++)
    cumulative.push(
      cumulative[i - 1] + metresBetween(points[i - 1], points[i]),
    );
  return { points, cumulative, length: cumulative.at(-1)! };
}
/** Restrict matching to plausible progress; ties at crossings prefer the previous position. */
export function project(
  path: Path,
  point: Coordinate,
  min = 0,
  max = path.length,
  prefer = min,
): Projection {
  let best: Projection = {
    point: path.points[0],
    distance: 0,
    offset: Infinity,
  };
  for (let i = 1; i < path.points.length; i++) {
    const from = path.cumulative[i - 1],
      to = path.cumulative[i],
      len = to - from;
    if (to < min || from > max || len <= 0) continue;
    const a = path.points[i - 1],
      b = path.points[i],
      scale = 111320 * Math.cos((point[1] * Math.PI) / 180);
    const dx = delta(a[0], b[0]) * scale,
      dy = (b[1] - a[1]) * 111320,
      px = delta(a[0], point[0]) * scale,
      py = (point[1] - a[1]) * 111320;
    const t = Math.max(
      Math.max(0, (min - from) / len),
      Math.min(
        Math.min(1, (max - from) / len),
        (dx * px + dy * py) / (dx * dx + dy * dy || 1),
      ),
    );
    const p = interpolate(a, b, t),
      offset = metresBetween(point, p),
      distance = from + len * t;
    if (
      offset < best.offset - 1 ||
      (Math.abs(offset - best.offset) <= 1 &&
        Math.abs(distance - prefer) < Math.abs(best.distance - prefer))
    )
      best = { point: p, offset, distance };
  }
  return best;
}
export function pointAt(path: Path, distance: number): Coordinate {
  const target = Math.max(0, Math.min(path.length, distance));
  for (let i = 1; i < path.points.length; i++)
    if (path.cumulative[i] >= target)
      return interpolate(
        path.points[i - 1],
        path.points[i],
        (target - path.cumulative[i - 1]) /
          (path.cumulative[i] - path.cumulative[i - 1] || 1),
      );
  return path.points.at(-1)!;
}
export function nextInstruction(
  route: PlannedRoute,
  metres: number,
  total: number,
  joining = false,
) {
  const distance = total > 0 ? (metres / total) * route.distance : 0;
  let passed = 0;
  for (let i = 0; i < route.steps.length; i++) {
    const step = route.steps[i];
    if (passed + step.distance > distance + 5) {
      const next = route.steps[i + 1];
      return {
        text:
          (joining && next?.instruction === '到达终点'
            ? '接回原路线'
            : next?.instruction) ?? (joining ? '接回原路线' : '沿路线到达终点'),
        distance: Math.max(0, passed + step.distance - distance),
      };
    }
    passed += step.distance;
  }
  return {
    text: joining ? '接回原路线' : '沿路线到达终点',
    distance: Math.max(0, total - metres),
  };
}
