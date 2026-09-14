import type { PlannedRoute, RoutePlace, TravelMode } from '../navigation/types';
import { inBounds } from './types.ts';
import { listGraphs, loadGraph } from './storage.ts';
import { offlineRoute } from './engine.ts';
import { routingMode } from './preferences.ts';
export async function tryOfflineRoute(
  stops: RoutePlace[],
  mode: TravelMode,
  signal: AbortSignal,
  preference = routingMode(),
): Promise<PlannedRoute | null> {
  if (preference === 'online') return null;
  if (mode !== 'pedestrian') {
    if (preference === 'offline')
      throw new Error(
        '离线引擎当前支持步行，请切换步行；驾车/骑行使用在线规划',
      );
    return null;
  }
  const matching = (await listGraphs())
    .filter((g) => stops.every((s) => inBounds(s.coordinates, g.bounds)))
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const item of matching) {
    signal.throwIfAborted();
    try {
      return await offlineRoute(await loadGraph(item.id), stops, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (preference === 'offline' && item === matching.at(-1)) throw error;
    }
  }
  if (preference === 'offline')
    throw new Error('没有覆盖起终点和途经点的离线路网，请先在行程→离线下载');
  return null;
}
export async function offlinePlaces(query: string): Promise<RoutePlace[]> {
  const names = new Map<string, RoutePlace>();
  for (const manifest of await listGraphs()) {
    const graph = await loadGraph(manifest.id),
      points = new Map(graph.nodes.map((n) => [n.id, n.point]));
    for (const edge of graph.edges) {
      const point = points.get(edge.from)!;
      if (
        inBounds(point, graph.bounds) &&
        edge.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
        !names.has(edge.name)
      )
        names.set(edge.name, {
          name: edge.name,
          coordinates: point,
          detail: `离线路网 · ${manifest.name}`,
        });
    }
    if (names.size >= 20) break;
  }
  return [...names.values()].slice(0, 20);
}
