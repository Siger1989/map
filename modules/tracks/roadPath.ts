import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { RoadLine, RoadMatch } from './roadSnapping';

type Node = { point: Coordinate; edges: Map<string, number> };
const key = (p: Coordinate) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const JOIN_METRES = 3;
const xy = ([lng, lat]: Coordinate) => [
  ((lng * Math.PI) / 180) * 6378137,
  Math.asinh(Math.tan((lat * Math.PI) / 180)) * 6378137,
];

/** Follow road geometry by distance, joining small endpoint seams regardless of road layer. */
export function roadPath(
  from: RoadMatch,
  to: RoadMatch,
  lines: RoadLine[],
): Coordinate[] | null {
  const graph = new Map<string, Node>();
  const node = (id: string, point: Coordinate) => {
    if (!graph.has(id)) graph.set(id, { point, edges: new Map() });
    return id;
  };
  const link = (a: string, b: string) => {
    const left = graph.get(a)!,
      right = graph.get(b)!;
    const distance = metresBetween(left.point, right.point);
    left.edges.set(b, Math.min(left.edges.get(b) ?? Infinity, distance));
    right.edges.set(a, Math.min(right.edges.get(a) ?? Infinity, distance));
  };
  const roads = [
    ...new Map(
      [...lines, from.line, to.line].map((line) => [line.id, line]),
    ).values(),
  ];
  const endpoints: { id: string; x: number; y: number }[] = [];
  for (const line of roads) {
    for (const point of line.coordinates) node(key(point), point);
    if (graph.size > 12000) return null;
    for (const point of [line.coordinates[0], line.coordinates.at(-1)!]) {
      const [x, y] = xy(point);
      endpoints.push({ id: key(point), x, y });
    }
  }
  endpoints.sort((a, b) => a.x - b.x);
  const cutsByLine = new Map<string, { id: string; t: number }[][]>();
  for (const line of roads) {
    const lineCuts: { id: string; t: number }[][] = [];
    cutsByLine.set(line.id, lineCuts);
    for (let i = 0; i < line.coordinates.length - 1; i++) {
      const a = line.coordinates[i],
        b = line.coordinates[i + 1];
      const [ax, ay] = xy(a),
        [bx, by] = xy(b);
      const dx = bx - ax,
        dy = by - ay,
        length2 = dx * dx + dy * dy;
      const cuts = [
        { id: key(a), t: 0 },
        { id: key(b), t: 1 },
      ];
      // Allow up to 3 ground metres for quantized tile seams and nearby road ends.
      // Clamp to endpoints too, so a small end-to-end gap does not block the route.
      const tolerance =
        JOIN_METRES /
        Math.max(0.08, Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180));
      let low = 0,
        high = endpoints.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (endpoints[mid].x < Math.min(ax, bx) - tolerance) low = mid + 1;
        else high = mid;
      }
      for (
        let j = low;
        length2 > 0 &&
        j < endpoints.length &&
        endpoints[j].x <= Math.max(ax, bx) + tolerance;
        j++
      ) {
        const end = endpoints[j];
        if (
          end.y < Math.min(ay, by) - tolerance ||
          end.y > Math.max(ay, by) + tolerance
        )
          continue;
        const t = Math.max(
          0,
          Math.min(1, ((end.x - ax) * dx + (end.y - ay) * dy) / length2),
        );
        if (Math.hypot(end.x - ax - t * dx, end.y - ay - t * dy) <= tolerance)
          cuts.push({ id: end.id, t });
      }
      cuts.sort((a, b) => a.t - b.t);
      for (let j = 1; j < cuts.length; j++) link(cuts[j - 1].id, cuts[j].id);
      lineCuts.push(cuts);
    }
  }
  const attach = (id: string, match: RoadMatch) => {
    node(id, match.coordinate);
    const cuts = cutsByLine.get(match.line.id)![match.index];
    const after = Math.max(
      1,
      cuts.findIndex((cut) => cut.t >= match.fraction),
    );
    const a = cuts[after - 1].id,
      b = cuts[after].id;
    link(id, a);
    link(id, b);
    return [a, b].sort().join('|');
  };
  const first = attach('start', from),
    last = attach('end', to);
  if (first === last) link('start', 'end');

  // Binary heap keeps pointer previews bounded on dense road tiles.
  const heap: [number, string][] = [];
  const push = (value: [number, string]) => {
    let i = heap.length;
    heap.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= value[0]) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = value;
  };
  const pop = () => {
    const result = heap[0],
      value = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0])
          child++;
        if (heap[child][0] >= value[0]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = value;
    }
    return result;
  };
  const distance = new Map<string, number>([['start', 0]]);
  const previous = new Map<string, string>();
  push([0, 'start']);
  while (heap.length) {
    const [cost, id] = pop();
    if (cost !== distance.get(id)) continue;
    if (id === 'end') {
      const points: Coordinate[] = [];
      let cursor = 'end';
      while (cursor !== 'start') {
        const point = graph.get(cursor)!.point;
        if (!points.length || metresBetween(points.at(-1)!, point) > 0.01)
          points.push(point);
        cursor = previous.get(cursor)!;
      }
      points.reverse();
      while (
        points.length > 1 &&
        metresBetween(points[0], from.coordinate) < 0.01
      )
        points.shift();
      return points.length <= 6000 ? points : null;
    }
    for (const [next, weight] of graph.get(id)!.edges) {
      const candidate = cost + weight;
      if (candidate < (distance.get(next) ?? Infinity)) {
        distance.set(next, candidate);
        previous.set(next, id);
        push([candidate, next]);
      }
    }
  }
  return null;
}
