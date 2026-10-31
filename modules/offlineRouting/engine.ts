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
  type StoredOfflineGraph,
  type StoredRoutingEdge,
} from './types.ts';
import { connectRoadAccess } from '../navigation/roadAccess.ts';
import { snapOfflineStops } from './snapping.ts';

class Heap {
  items: { id: number; state: string; cost: number }[] = [];
  push(item: { id: number; state: string; cost: number }) {
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
export function validateGraph(value: unknown): StoredOfflineGraph {
  const g = value as StoredOfflineGraph;
  const header = value as { format?: string; version?: number; profile?: string } | null;
  if (header?.format === 'shantu-offline-routing' && header.version === 1 && header.profile !== 'pedestrian')
    throw new Error('旧版离线路网仅支持步行；车辆规划请重新下载对应道路类型的离线路网');
  if (
    !g ||
    g.format !== 'shantu-offline-routing' ||
    ![1, 2].includes(g.version) ||
    (g.version === 1 ? g.profile !== 'pedestrian' : !['pedestrian', 'motorcar', 'motorcycle'].includes(g.profile)) ||
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
  const incomingWayByNode = new Map<number, Set<number>>(),
    outgoingWayByNode = new Map<number, Set<number>>();
  for (const e of g.edges)
    if (
      !e ||
      !ids.has(e.from) ||
      !ids.has(e.to) ||
      !Number.isFinite(e.metres) ||
      e.metres <= 0 ||
      e.metres + 0.01 < metresBetween(points.get(e.from)!, points.get(e.to)!) ||
      (g.version === 2 && (!('wayId' in e) || !Number.isSafeInteger(e.wayId))) ||
      typeof e.name !== 'string' ||
      e.name.length > 100
    )
      throw new Error('离线路网连接无效');
    else if ('wayId' in e) {
      if (!incomingWayByNode.has(e.to)) incomingWayByNode.set(e.to, new Set());
      incomingWayByNode.get(e.to)!.add(e.wayId);
      if (!outgoingWayByNode.has(e.from)) outgoingWayByNode.set(e.from, new Set());
      outgoingWayByNode.get(e.from)!.add(e.wayId);
    }
  const turnRestrictions = g.version === 2 ? g.turnRestrictions : [];
  if (!Array.isArray(turnRestrictions) || turnRestrictions.length > GRAPH_LIMITS.edges)
    throw new Error('离线路网转向限制无效');
  for (const r of turnRestrictions)
    if (!r || !ids.has(r.viaNodeId) || !Number.isSafeInteger(r.fromWayId) ||
        !Number.isSafeInteger(r.toWayId) || !['no', 'only'].includes(r.kind) ||
        !incomingWayByNode.get(r.viaNodeId)?.has(r.fromWayId) ||
        (r.kind === 'no' && outgoingWayByNode.has(r.viaNodeId) && !outgoingWayByNode.get(r.viaNodeId)!.has(r.toWayId)))
      throw new Error('离线路网转向限制无效');
  if (typeof g.attribution !== 'string' || g.attribution.length > 500)
    throw new Error('离线路网来源无效');
  return g;
}
/** A* over downloaded topology. Yield periodically so cancellation/UI remain responsive. */
export async function offlineRoute(
  graph: StoredOfflineGraph,
  stops: RoutePlace[],
  signal: AbortSignal,
): Promise<PlannedRoute> {
  signal.throwIfAborted();
  const g = validateGraph(graph);
  if (g.profile !== 'pedestrian' && stops.length !== 2)
    throw new Error('离线驾车/摩托车目前只支持起点和终点；含途经点请改用在线规划');
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
    adj = new Map<number, StoredRoutingEdge[]>();
  for (const e of snapped.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }
  const turnRestrictionsByNodeAndWay = new Map<string, { kind: 'no' | 'only'; toWayId: number }[]>();
  if (g.version === 2)
    for (const restriction of g.turnRestrictions) {
      const key = `${restriction.viaNodeId}/${restriction.fromWayId}`,
        current = turnRestrictionsByNodeAndWay.get(key);
      turnRestrictionsByNodeAndWay.set(key, [...(current ?? []), { kind: restriction.kind, toWayId: restriction.toWayId }]);
    }
  const legs: Coordinate[][] = [],
    steps: PlannedRoute['steps'] = [];
  const nominalSpeed = g.profile === 'pedestrian' ? 4 : g.profile === 'motorcycle' ? 35 : 30;
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
    const stateId = (nodeId: number, incomingWayId: number | null) => `${nodeId}/${incomingWayId ?? '_'}`;
    const initial = stateId(start, null),
      queue = new Heap(),
      costs = new Map([[initial, 0]]),
      previous = new Map<string, { state: string; edge: StoredRoutingEdge }>(),
      stateNodes = new Map([[initial, start]]),
      stateWays = new Map<string, number | null>([[initial, null]]),
      closed = new Set<string>();
    queue.push({ id: start, state: initial, cost: 0 });
    let endState: string | null = null;
    while (queue.items.length) {
      const { id: nodeId, state: currentState } = queue.pop();
      if (closed.has(currentState)) continue;
      if (nodeId === end) { endState = currentState; break; }
      closed.add(currentState);
      if (closed.size % 512 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
      }
      const incomingWay = stateWays.get(currentState) ?? null;
      for (const edge of adj.get(nodeId) ?? []) {
        const edgeWayId = 'wayId' in edge ? edge.wayId : null,
          restrictions = turnRestrictionsByNodeAndWay.get(`${nodeId}/${incomingWay}`) ?? [],
          blocked = restrictions.some((r) => r.kind === 'no' && r.toWayId === edgeWayId) ||
            restrictions.some((r) => r.kind === 'only' && r.toWayId !== edgeWayId);
        if (blocked) continue;
        const cost = costs.get(currentState)! + edge.metres,
          nextState = stateId(edge.to, 'wayId' in edge ? edge.wayId : null);
        if (cost >= (costs.get(nextState) ?? Infinity)) continue;
        costs.set(nextState, cost);
        stateNodes.set(nextState, edge.to);
        stateWays.set(nextState, 'wayId' in edge ? edge.wayId : null);
        previous.set(nextState, { state: currentState, edge });
        queue.push({ id: edge.to, state: nextState, cost: cost + metresBetween(points.get(edge.to)!, points.get(end)!) });
      }
    }
    if (!endState)
      throw new Error('下载区域内道路不连通；请扩大路网范围或更换选点');
    const edges: StoredRoutingEdge[] = [];
    let cursor = endState;
    while (cursor !== initial) {
      const prev = previous.get(cursor);
      const edge = prev?.edge;
      if (!edge || edges.length > snapped.nodes.length + snapped.edges.length)
        throw new Error('离线路径无效');
      edges.push(edge);
      cursor = prev!.state;
    }
    edges.reverse();
    const line = [points.get(start)!, ...edges.map((e) => points.get(e.to)!)];
    legs.push(line);
    for (const edge of edges) {
      distance += edge.metres;
      duration += edge.metres / (nominalSpeed * 1000 / 3600);
      const last = steps.at(-1);
      if (
        last?.legIndex === leg - 1 &&
        last.instruction === `沿 ${edge.name} 行进`
      ) {
        last.distance += edge.metres;
        last.duration += edge.metres / (nominalSpeed * 1000 / 3600);
        last.elapsedSeconds = duration;
        last.coordinates.push(points.get(edge.to)!);
      } else
        steps.push({
          kind: 'road',
          legIndex: leg - 1,
          instruction: `沿 ${edge.name} 行进`,
          distance: edge.metres,
          duration: edge.metres / (nominalSpeed * 1000 / 3600),
          elapsedSeconds: duration,
          coordinates: [points.get(edge.from)!, points.get(edge.to)!],
        });
    }
  }
  signal.throwIfAborted();
  return connectRoadAccess(
    {
      mode: g.profile === 'pedestrian' ? 'pedestrian' : g.profile === 'motorcycle' ? 'motorcycle' : 'auto',
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
