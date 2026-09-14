import {
  metresBetween,
  type Coordinate,
  type RoutePlace,
} from '../navigation/types.ts';
import {
  GRAPH_LIMITS,
  type OfflineGraph,
  type RoutingNode,
  type RoutingEdge,
} from './types.ts';
/** Split only the selected topological edge. Nearby parallel roads never become joined. */
export function snapOfflineStops(g: OfflineGraph, stops: RoutePlace[]) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n])),
    pairs = new Map<
      string,
      { a: number; b: number; cuts: { id: number; t: number }[] }
    >();
  for (const edge of g.edges) {
    const a = Math.min(edge.from, edge.to),
      b = Math.max(edge.from, edge.to),
      key = `${a}/${b}`;
    if (!pairs.has(key)) pairs.set(key, { a, b, cuts: [] });
  }
  const nearest: RoutingNode[] = [];
  let nextId = -1;
  for (const n of g.nodes) nextId = Math.min(nextId, n.id - 1);
  for (const stop of stops) {
    let best: {
      pair: typeof pairs extends Map<string, infer V> ? V : never;
      t: number;
      point: Coordinate;
      distance: number;
    } | null = null;
    for (const pair of pairs.values()) {
      const a = nodes.get(pair.a)!.point,
        b = nodes.get(pair.b)!.point,
        c = Math.cos((stop.coordinates[1] * Math.PI) / 180);
      const dx = (((b[0] - a[0] + 540) % 360) - 180) * c,
        dy = b[1] - a[1],
        px = (((stop.coordinates[0] - a[0] + 540) % 360) - 180) * c,
        py = stop.coordinates[1] - a[1];
      const t = Math.max(
          0,
          Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
        ),
        point: Coordinate = [
          ((a[0] + (c ? dx / c : 0) * t + 540) % 360) - 180,
          a[1] + dy * t,
        ],
        distance = metresBetween(point, stop.coordinates);
      if (!best || distance < best.distance)
        best = { pair, t, point, distance };
    }
    if (!best || best.distance > GRAPH_LIMITS.snapMetres)
      throw new Error(
        `“${stop.name}”距已下载道路超过${GRAPH_LIMITS.snapMetres}米，请在道路附近选点`,
      );
    const { pair, t, point } = best;
    const existing = pair.cuts.find(
      (cut) => metresBetween(nodes.get(cut.id)!.point, point) < 0.1,
    );
    const id =
      t < 1e-9 ? pair.a : t > 1 - 1e-9 ? pair.b : (existing?.id ?? nextId--);
    if (!nodes.has(id)) {
      nodes.set(id, { id, point });
      pair.cuts.push({ id, t });
    }
    nearest.push(nodes.get(id)!);
  }
  const edges: RoutingEdge[] = [];
  for (const edge of g.edges) {
    const pair = pairs.get(
      `${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`,
    )!;
    if (!pair.cuts.length) {
      edges.push(edge);
      continue;
    }
    const cuts = [
      { id: pair.a, t: 0 },
      ...pair.cuts.slice().sort((a, b) => a.t - b.t),
      { id: pair.b, t: 1 },
    ];
    if (edge.from === pair.b) cuts.reverse();
    for (let i = 1; i < cuts.length; i++)
      if (cuts[i].id !== cuts[i - 1].id)
        edges.push({
          ...edge,
          from: cuts[i - 1].id,
          to: cuts[i].id,
          metres: edge.metres * Math.abs(cuts[i].t - cuts[i - 1].t),
        });
  }
  return { nodes: [...nodes.values()], edges, nearest };
}
