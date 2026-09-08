import {
  metresBetween,
  type Coordinate,
  type PlannedRoute,
} from '../navigation/types.ts';
import { pathOf, project, type Path } from './geometry.ts';
import type { ManualTrack } from '../tracks/drawing';

// Only coincident saved vertices form a junction. Lines crossing on screen do not.
export const vertexKey = (p: Coordinate) =>
  `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
type Vertex = { point: Coordinate; edges: { to: string; length: number }[] };
type Graph = {
  vertices: Map<string, Vertex>;
  edges: { a: string; b: string; path: Path }[];
};
const cache = new WeakMap<Coordinate[][], Graph>();
function graphOf(segments: Coordinate[][]): Graph {
  const cached = cache.get(segments);
  if (cached) return cached;
  const vertices = new Map<string, Vertex>(),
    edges: Graph['edges'] = [];
  for (const line of segments)
    for (let i = 1; i < line.length; i++) {
      const a = vertexKey(line[i - 1]),
        b = vertexKey(line[i]);
      if (!vertices.has(a)) vertices.set(a, { point: line[i - 1], edges: [] });
      if (!vertices.has(b)) vertices.set(b, { point: line[i], edges: [] });
      if (a === b) continue;
      const path = pathOf([line[i - 1], line[i]]);
      vertices.get(a)!.edges.push({ to: b, length: path.length });
      vertices.get(b)!.edges.push({ to: a, length: path.length });
      edges.push({ a, b, path });
    }
  const graph = { vertices, edges };
  cache.set(segments, graph);
  return graph;
}

class Queue {
  values: { key: string; cost: number }[] = [];
  push(key: string, cost: number) {
    const value = { key, cost },
      list = this.values;
    list.push(value);
    let i = list.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (list[parent].cost <= cost) break;
      list[i] = list[parent];
      i = parent;
    }
    list[i] = value;
  }
  pop() {
    const list = this.values,
      first = list[0],
      last = list.pop();
    if (!list.length || !last) return first;
    let i = 0;
    while (i * 2 + 1 < list.length) {
      let child = i * 2 + 1;
      if (child + 1 < list.length && list[child + 1].cost < list[child].cost)
        child++;
      if (list[child].cost >= last.cost) break;
      list[i] = list[child];
      i = child;
    }
    list[i] = last;
    return first;
  }
}
const trees = new WeakMap<
  Graph,
  Map<string, { costs: Map<string, number>; next: Map<string, string> }>
>();
function toward(graph: Graph, goal: string, blocked?: [string, string]) {
  let entries = trees.get(graph);
  if (!entries) {
    entries = new Map();
    trees.set(graph, entries);
  }
  const cacheKey = goal + (blocked ? `|${blocked.join('|')}` : '');
  const cached = entries.get(cacheKey);
  if (cached) return cached;
  const costs = new Map<string, number>([[goal, 0]]),
    next = new Map<string, string>(),
    queue = new Queue();
  queue.push(goal, 0);
  while (queue.values.length) {
    const current = queue.pop()!;
    if (current.cost !== costs.get(current.key)) continue;
    for (const edge of graph.vertices.get(current.key)?.edges ?? []) {
      if (
        blocked &&
        ((current.key === blocked[0] && edge.to === blocked[1]) ||
          (current.key === blocked[1] && edge.to === blocked[0]))
      )
        continue;
      const cost = current.cost + edge.length;
      if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, cost);
      next.set(edge.to, current.key);
      queue.push(edge.to, cost);
    }
  }
  if (entries.size > 24) entries.clear();
  const result = { costs, next };
  entries.set(cacheKey, result);
  return result;
}

/** Capture only the seed's connected component, excluding unrelated or detached branches. */
export function connectedNetwork(seed: ManualTrack, tracks: ManualTrack[]) {
  const all = [
    seed,
    ...tracks.filter((t) => t.id !== seed.id && !t.hidden),
  ].flatMap((t) => t.segments);
  const graph = graphOf(all),
    root = vertexKey(seed.segments[0][0]);
  const reachable = toward(graph, root).costs;
  if (seed.segments.flat().some((p) => !reachable.has(vertexKey(p))))
    throw new Error('轨迹含不相接的线段，请先通过节点连接再导航。');
  return all.filter(
    (line) => line.length >= 2 && reachable.has(vertexKey(line[0])),
  );
}
export function networkEndpoints(segments: Coordinate[][]): Coordinate[] {
  const graph = graphOf(segments);
  const ends = [...graph.vertices.values()]
    .filter((v) => new Set(v.edges.map((e) => e.to)).size === 1)
    .map((v) => v.point);
  return ends.length ? ends : [segments[0][0], segments[0].at(-1)!];
}

/** Nearest reachable edge first; shortest remaining path to the chosen destination second. */
export function networkPath(
  segments: Coordinate[][],
  from: Coordinate,
  destination: Coordinate,
  headingFrom?: Coordinate,
) {
  const graph = graphOf(segments),
    goal = vertexKey(destination);
  if (!graph.vertices.has(goal))
    throw new Error('终点不在已连接的路线节点上。');
  let tree = toward(graph, goal);
  let best: {
    point: Coordinate;
    offset: number;
    cost: number;
    via: string;
    a: string;
    b: string;
  } | null = null;
  for (const edge of graph.edges) {
    const hit = project(edge.path, from);
    const aCost = (tree.costs.get(edge.a) ?? Infinity) + hit.distance;
    const bCost =
      (tree.costs.get(edge.b) ?? Infinity) + edge.path.length - hit.distance;
    const cost = Math.min(aCost, bCost);
    if (!Number.isFinite(cost)) continue;
    if (
      !best ||
      hit.offset < best.offset - 0.05 ||
      (Math.abs(hit.offset - best.offset) <= 0.05 && cost < best.cost)
    )
      best = {
        point: hit.point,
        offset: hit.offset,
        cost,
        via: aCost <= bCost ? edge.a : edge.b,
        a: edge.a,
        b: edge.b,
      };
  }
  if (!best) throw new Error('没有能通向所选终点的相连路线。');
  if (headingFrom && metresBetween(headingFrom, from) >= 5) {
    const a = graph.vertices.get(best.a)!.point,
      b = graph.vertices.get(best.b)!.point;
    const scale = Math.cos((from[1] * Math.PI) / 180);
    const dx = ((from[0] - headingFrom[0] + 540) % 360) - 180,
      ex = ((b[0] - a[0] + 540) % 360) - 180;
    const dot =
      dx * ex * scale * scale + (from[1] - headingFrom[1]) * (b[1] - a[1]);
    if (Math.abs(dot) > 1e-12) {
      const via = dot > 0 ? best.b : best.a,
        forward = toward(graph, goal, [best.a, best.b]);
      // Continue the branch actually being walked when it reaches the goal without immediately reversing.
      if (forward.costs.has(via)) {
        best.via = via;
        tree = forward;
      }
    }
  }
  const points: Coordinate[] = [best.point];
  for (let key: string | undefined = best.via; key; key = tree.next.get(key)) {
    const point = graph.vertices.get(key)!.point;
    if (metresBetween(points.at(-1)!, point) > 0.001) points.push(point);
  }
  if (points.length < 2) points.push([...destination]);
  return { coordinates: points, offset: best.offset };
}
export function routeOnNetwork(
  route: PlannedRoute,
  from: Coordinate,
  destination = route.coordinates.at(-1)!,
  headingFrom?: Coordinate,
) {
  if (!route.trackNetwork)
    return { route, offset: project(pathOf(route.coordinates), from).offset };
  const hit = networkPath(route.trackNetwork, from, destination, headingFrom);
  if (route.preferredTrackPath?.length && !headingFrom) {
    const preferred = pathOf(route.preferredTrackPath),
      selected = project(preferred, from);
    // Nearest entry wins; when the chosen itinerary is equally near, do not shortcut its detour.
    if (
      selected.offset <= hit.offset + 0.05 &&
      vertexKey(preferred.points.at(-1)!) === vertexKey(destination)
    ) {
      const rest = preferred.points.filter(
        (_, i) => preferred.cumulative[i] > selected.distance + 0.001,
      );
      hit.coordinates = [selected.point, ...rest];
      if (hit.coordinates.length < 2) hit.coordinates.push(destination);
      hit.offset = selected.offset;
    }
  }
  const distance = pathOf(hit.coordinates).length;
  return {
    offset: hit.offset,
    route: {
      ...route,
      coordinates: hit.coordinates,
      distance,
      duration:
        distance /
        ({ pedestrian: 4000, bicycle: 15000, auto: 40000 }[route.mode] / 3600),
      steps: [],
      snapped: [hit.coordinates[0], destination],
      stops: [
        { name: '最近接入点', coordinates: hit.coordinates[0] },
        { name: route.stops?.at(-1)?.name ?? '终点', coordinates: destination },
      ],
    } satisfies PlannedRoute,
  };
}
