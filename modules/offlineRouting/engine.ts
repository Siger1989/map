import {
  coordinate,
  metresBetween,
  type Coordinate,
  type PlannedRoute,
  type RoutePlace,
} from '../navigation/types.ts';
import {
  GRAPH_LIMITS,
  inBounds,
  type OfflineGraph,
  type RoutingEdge,
} from './types.ts';
import { connectRoadAccess } from '../navigation/roadAccess.ts';
import { snapOfflineStops } from './snapping.ts';

class Heap {
  items: { id: number; cost: number }[] = [];
  push(item: { id: number; cost: number }) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= item.cost) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items,
      first = a[0],
      last = a.pop();
    if (a.length && last) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].cost < a[c].cost) c++;
        if (a[c].cost >= last.cost) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return first;
  }
}
export function validateGraph(value: unknown): OfflineGraph {
  const g = value as OfflineGraph;
  if (
    !g ||
    g.format !== 'shantu-offline-routing' ||
    g.version !== 1 ||
    g.profile !== 'pedestrian' ||
    typeof g.id !== 'string' ||
    !g.id ||
    g.id.length > 100 ||
    typeof g.name !== 'string' ||
    g.name.length > 60 ||
    !Number.isFinite(g.createdAt) ||
    !Array.isArray(g.bounds) ||
    g.bounds.length !== 4 ||
    !coordinate(g.bounds.slice(0, 2)) ||
    !coordinate(g.bounds.slice(2)) ||
    g.bounds[0] >= g.bounds[2] ||
    g.bounds[1] >= g.bounds[3] ||
    !Array.isArray(g.nodes) ||
    g.nodes.length < 2 ||
    g.nodes.length > GRAPH_LIMITS.nodes ||
    !Array.isArray(g.edges) ||
    g.edges.length < 1 ||
    g.edges.length > GRAPH_LIMITS.edges
  )
    throw new Error('离线路网格式无效');
  const ids = new Set<number>();
  for (const n of g.nodes) {
    if (
      !n ||
      !Number.isSafeInteger(n.id) ||
      !coordinate(n.point) ||
      ids.has(n.id)
    )
      throw new Error('离线路网节点无效');
    ids.add(n.id);
  }
  const points = new Map(g.nodes.map((n) => [n.id, n.point]));
  for (const e of g.edges)
    if (
      !e ||
      !ids.has(e.from) ||
      !ids.has(e.to) ||
      !Number.isFinite(e.metres) ||
      e.metres <= 0 ||
      e.metres + 0.01 < metresBetween(points.get(e.from)!, points.get(e.to)!) ||
      typeof e.name !== 'string' ||
      e.name.length > 100
    )
      throw new Error('离线路网连接无效');
  if (typeof g.attribution !== 'string' || g.attribution.length > 500)
    throw new Error('离线路网来源无效');
  return g;
}
/** A* over downloaded topology. Yield periodically so cancellation/UI remain responsive. */
export async function offlineRoute(
  graph: OfflineGraph,
  stops: RoutePlace[],
  signal: AbortSignal,
): Promise<PlannedRoute> {
  signal.throwIfAborted();
  const g = validateGraph(graph);
  if (
    stops.length < 2 ||
    stops.length > 10 ||
    stops.some(
      (s) => !coordinate(s.coordinates) || !inBounds(s.coordinates, g.bounds),
    )
  )
    throw new Error('起终点或途经点超出此离线路网范围');
  const snapped = snapOfflineStops(g, stops),
    nearest = snapped.nearest;
  const points = new Map(snapped.nodes.map((n) => [n.id, n.point])),
    adj = new Map<number, RoutingEdge[]>();
  for (const e of snapped.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }
  const legs: Coordinate[][] = [],
    steps: PlannedRoute['steps'] = [];
  let distance = 0,
    duration = 0;
  for (let leg = 1; leg < nearest.length; leg++) {
    signal.throwIfAborted();
    const start = nearest[leg - 1].id,
      end = nearest[leg].id;
    if (start === end) {
      legs.push([points.get(start)!, points.get(end)!]);
      continue;
    }
    const queue = new Heap(),
      costs = new Map([[start, 0]]),
      previous = new Map<number, RoutingEdge>(),
      closed = new Set<number>();
    queue.push({ id: start, cost: 0 });
    while (queue.items.length) {
      const { id } = queue.pop();
      if (closed.has(id)) continue;
      if (id === end) break;
      closed.add(id);
      if (closed.size % 512 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
      }
      for (const edge of adj.get(id) ?? []) {
        const cost = costs.get(id)! + edge.metres;
        if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
        costs.set(edge.to, cost);
        previous.set(edge.to, edge);
        queue.push({
          id: edge.to,
          cost: cost + metresBetween(points.get(edge.to)!, points.get(end)!),
        });
      }
    }
    if (!previous.has(end))
      throw new Error('下载区域内道路不连通；请扩大路网范围或更换选点');
    const edges: RoutingEdge[] = [];
    let cursor = end;
    while (cursor !== start) {
      const edge = previous.get(cursor);
      if (!edge || edges.length > g.nodes.length)
        throw new Error('离线路径无效');
      edges.push(edge);
      cursor = edge.from;
    }
    edges.reverse();
    const line = [points.get(start)!, ...edges.map((e) => points.get(e.to)!)];
    legs.push(line);
    for (const edge of edges) {
      distance += edge.metres;
      duration += edge.metres / (4000 / 3600);
      const last = steps.at(-1);
      if (
        last?.legIndex === leg - 1 &&
        last.instruction === `沿 ${edge.name} 行进`
      ) {
        last.distance += edge.metres;
        last.duration += edge.metres / (4000 / 3600);
        last.elapsedSeconds = duration;
        last.coordinates.push(points.get(edge.to)!);
      } else
        steps.push({
          kind: 'road',
          legIndex: leg - 1,
          instruction: `沿 ${edge.name} 行进`,
          distance: edge.metres,
          duration: edge.metres / (4000 / 3600),
          elapsedSeconds: duration,
          coordinates: [points.get(edge.from)!, points.get(edge.to)!],
        });
    }
  }
  signal.throwIfAborted();
  return connectRoadAccess(
    {
      mode: 'pedestrian',
      coordinates: legs.flatMap((l, i) => (i ? l.slice(1) : l)),
      distance,
      duration,
      steps,
      snapped: nearest.map((n) => n.point),
      roadLegs: legs,
      createdAt: Date.now(),
      routingSource: { kind: 'offline', name: g.name, createdAt: g.createdAt },
    },
    stops,
  );
}
