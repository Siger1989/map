import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { RoadLine, RoadMatch } from './roadSnapping';

type Node = { point: Coordinate; edges: Map<string, number> };
type Cut = { id: string; t: number };
type PreparedNetwork = {
  graph: Map<string, Node>;
  cutsByLine: Map<string, Cut[][]>;
};
type PreparedNetworkResult = { status: 'ready'; network: PreparedNetwork } | { status: 'limited' };
export type RoadPathResult =
  | { status: 'ready'; section: Coordinate[] }
  | { status: 'disconnected' }
  | { status: 'limited' };

const key = (p: Coordinate) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const JOIN_METRES = 3;
// roadPath runs synchronously on the map thread. Bound each network build and
// each route query; the rendered line array is stable while a stroke is active,
// so its split graph can be reused between pointer moves.
export const MAX_ROAD_PATH_INPUT_POINTS = 3000;
export const MAX_ROAD_PATH_ENDPOINT_CHECKS = 150_000;
export const MAX_ROAD_PATH_EXPANSIONS = 4000;
const preparedNetworks = new WeakMap<readonly RoadLine[], PreparedNetworkResult>();
const xy = ([lng, lat]: Coordinate) => [
  ((lng * Math.PI) / 180) * 6378137,
  Math.asinh(Math.tan((lat * Math.PI) / 180)) * 6378137,
];

function prepareNetwork(roads: RoadLine[]): PreparedNetworkResult {
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
  if (
    roads.reduce((total, line) => total + line.coordinates.length, 0) >
    MAX_ROAD_PATH_INPUT_POINTS
  )
    return { status: 'limited' };

  const endpoints: { id: string; x: number; y: number }[] = [];
  for (const line of roads) {
    if (line.coordinates.length < 2) continue;
    for (const point of line.coordinates) node(key(point), point);
    if (graph.size > 12000) return { status: 'limited' };
    for (const point of [line.coordinates[0], line.coordinates.at(-1)!]) {
      const [x, y] = xy(point);
      endpoints.push({ id: key(point), x, y });
    }
  }
  endpoints.sort((a, b) => a.x - b.x);
  let endpointChecks = 0;
  const cutsByLine = new Map<string, Cut[][]>();
  for (const line of roads) {
    const lineCuts: Cut[][] = [];
    cutsByLine.set(line.id, lineCuts);
    for (let i = 0; i < line.coordinates.length - 1; i++) {
      const a = line.coordinates[i],
        b = line.coordinates[i + 1];
      const [ax, ay] = xy(a),
        [bx, by] = xy(b);
      const dx = bx - ax,
        dy = by - ay,
        length2 = dx * dx + dy * dy;
      const cuts: Cut[] = [
        { id: key(a), t: 0 },
        { id: key(b), t: 1 },
      ];
      // Allow up to 3 ground metres for quantized tile seams and nearby road ends.
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
        if (++endpointChecks > MAX_ROAD_PATH_ENDPOINT_CHECKS) return { status: 'limited' };
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
  return { status: 'ready', network: { graph, cutsByLine } };
}

function bracket(match: RoadMatch, network: PreparedNetwork) {
  const cuts = network.cutsByLine.get(match.line.id)?.[match.index];
  if (!cuts?.length) return null;
  const after = Math.max(1, cuts.findIndex((cut) => cut.t >= match.fraction));
  const before = cuts[after - 1],
    next = cuts[after];
  if (!before || !next) return null;
  return [before, next] as const;
}

function sameCoordinateSnapshot(a: RoadLine, b: RoadLine): boolean {
  if (a === b || a.coordinates === b.coordinates) return true;
  if (a.id !== b.id || a.coordinates.length !== b.coordinates.length) return false;
  for (let i = 0; i < a.coordinates.length; i++) {
    const left = a.coordinates[i], right = b.coordinates[i];
    if (left[0] !== right[0] || left[1] !== right[1]) return false;
  }
  return true;
}

function lineIsInSnapshot(lines: readonly RoadLine[], line: RoadLine): boolean {
  const candidate = lines.find((item) => item === line || item.id === line.id);
  return !!candidate && sameCoordinateSnapshot(candidate, line);
}

/** A real same-feature slice is safe when graph construction/search reaches its budget. */
function sameLineSection(from: RoadMatch, to: RoadMatch): Coordinate[] | null {
  if (!sameCoordinateSnapshot(from.line, to.line)) return null;
  const coordinates = from.line.coordinates;
  const maxPosition = coordinates.length - 1;
  const fromIndex = from.index + from.fraction;
  const toIndex = to.index + to.fraction;
  if (
    coordinates.length < 2 ||
    !Number.isFinite(fromIndex) || !Number.isFinite(toIndex) ||
    fromIndex < 0 || toIndex < 0 || fromIndex > maxPosition || toIndex > maxPosition ||
    from.index < 0 || to.index < 0 || from.index >= maxPosition || to.index >= maxPosition ||
    from.fraction < 0 || from.fraction > 1 || to.fraction < 0 || to.fraction > 1
  ) return null;

  const points: Coordinate[] = [];
  const append = (point: Coordinate) => {
    if (!points.length || metresBetween(points.at(-1)!, point) > 0.01) points.push(point);
  };
  if (toIndex > fromIndex) {
    for (let index = Math.floor(fromIndex) + 1; index < toIndex; index++) append(coordinates[index]);
  } else if (toIndex < fromIndex) {
    for (let index = Math.ceil(fromIndex) - 1; index > toIndex; index--) append(coordinates[index]);
  }
  append(to.coordinate);
  return points.length <= MAX_ROAD_PATH_INPUT_POINTS ? points : null;
}

function limitedOrSameLine(
  from: RoadMatch,
  to: RoadMatch,
  snapshot: readonly RoadLine[],
): RoadPathResult {
  const section = lineIsInSnapshot(snapshot, from.line) && lineIsInSnapshot(snapshot, to.line)
    ? sameLineSection(from, to)
    : null;
  return section ? { status: 'ready', section } : { status: 'limited' };
}

/** Detailed bounded network result; only a verified same-feature slice can bypass limits. */
export function roadPathDetailed(
  from: RoadMatch,
  to: RoadMatch,
  lines: RoadLine[],
): RoadPathResult {
  let snapshotLines = lines;
  let prepared = preparedNetworks.get(lines);
  if (prepared === undefined) {
    prepared = prepareNetwork(lines);
    preparedNetworks.set(lines, prepared);
  }
  if (prepared.status === 'limited') return limitedOrSameLine(from, to, snapshotLines);
  let network = prepared.network;
  // A match normally comes from the same rendered feature snapshot. If a caller
  // supplies an out-of-snapshot line, prepare a one-off index rather than cache
  // an incomplete graph against the shared snapshot.
  if (!network.cutsByLine.has(from.line.id) || !network.cutsByLine.has(to.line.id)) {
    const roads = [...new Map([...lines, from.line, to.line].map((line) => [line.id, line])).values()];
    snapshotLines = roads;
    prepared = prepareNetwork(roads);
    if (prepared.status === 'limited') return limitedOrSameLine(from, to, snapshotLines);
    network = prepared.network;
  }
  const startCuts = bracket(from, network),
    endCuts = bracket(to, network);
  if (!startCuts || !endCuts) return { status: 'disconnected' };
  // Clipped overlapping tiles can describe the same physical edge under
  // different line IDs. When both matches bracket the same split graph edge,
  // the straight endpoint section already follows that shared road geometry.
  if (
    (startCuts[0].id === endCuts[0].id &&
      startCuts[1].id === endCuts[1].id) ||
    (startCuts[0].id === endCuts[1].id &&
      startCuts[1].id === endCuts[0].id)
  )
    return { status: 'ready', section: [to.coordinate] };

  const { graph } = network;
  const startAccess = new Map<string, number>();
  for (const cut of startCuts) {
    const distance = metresBetween(from.coordinate, graph.get(cut.id)!.point);
    startAccess.set(cut.id, Math.min(startAccess.get(cut.id) ?? Infinity, distance));
  }
  const endAccess = new Map<string, number>();
  for (const cut of endCuts) {
    const distance = metresBetween(to.coordinate, graph.get(cut.id)!.point);
    endAccess.set(cut.id, Math.min(endAccess.get(cut.id) ?? Infinity, distance));
  }

  // A* uses geographic distance as an admissible lower bound. It visits the
  // corridor around a long route instead of running Dijkstra over the whole map
  // on every pointer event.
  const heap: [number, number, string][] = [];
  const push = (value: [number, number, string]) => {
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
  const pointFor = (id: string) =>
    id === 'start' ? from.coordinate : id === 'end' ? to.coordinate : graph.get(id)!.point;
  const heuristic = (id: string) => metresBetween(pointFor(id), to.coordinate);
  const relax = (current: string, next: string, weight: number, cost: number) => {
    const candidate = cost + weight;
    if (candidate < (distance.get(next) ?? Infinity)) {
      distance.set(next, candidate);
      previous.set(next, current);
      push([candidate + (next === 'end' ? 0 : heuristic(next)), candidate, next]);
    }
  };
  push([heuristic('start'), 0, 'start']);
  let expansions = 0;
  while (heap.length) {
    const [, cost, id] = pop();
    if (cost !== distance.get(id)) continue;
    if (id === 'end') {
      const points: Coordinate[] = [];
      let cursor = 'end';
      while (cursor !== 'start') {
        const point = pointFor(cursor);
        if (!points.length || metresBetween(points.at(-1)!, point) > 0.01)
          points.push(point);
        cursor = previous.get(cursor)!;
      }
      points.reverse();
      while (points.length > 1 && metresBetween(points[0], from.coordinate) < 0.01)
        points.shift();
      return points.length <= 6000 ? { status: 'ready', section: points } : { status: 'limited' };
    }
    if (++expansions > MAX_ROAD_PATH_EXPANSIONS) return limitedOrSameLine(from, to, snapshotLines);
    if (id === 'start') {
      for (const [next, weight] of startAccess) relax(id, next, weight, cost);
      continue;
    }
    for (const [next, weight] of graph.get(id)!.edges) relax(id, next, weight, cost);
    const endWeight = endAccess.get(id);
    if (endWeight !== undefined) relax(id, 'end', endWeight, cost);
  }
  return { status: 'disconnected' };
}

/** Backward-compatible wrapper for callers that only need a section or null. */
export function roadPath(
  from: RoadMatch,
  to: RoadMatch,
  lines: RoadLine[],
): Coordinate[] | null {
  const result = roadPathDetailed(from, to, lines);
  return result.status === 'ready' ? result.section : null;
}
