import type { PlannedRoute, RoutePlace, TravelMode } from '../navigation/types';
import { inBounds } from './types.ts';
import { listGraphs, loadGraph } from './storage.ts';
import { offlineRoute } from './engine.ts';
import { routingMode } from './preferences.ts';
import type { GraphManifest, OfflineProfile } from './types.ts';
export function matchingGraphs(
  graphs: GraphManifest[],
  stops: RoutePlace[],
  profile: OfflineProfile,
) {
  return graphs
    .filter((g) => g.profile === profile && stops.every((s) => inBounds(s.coordinates, g.bounds)))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export function offlineProfileForMode(mode: TravelMode): OfflineProfile | null {
  if (mode === 'auto') return 'motorcar';
  if (mode === 'motorcycle') return 'motorcycle';
  if (mode === 'pedestrian') return 'pedestrian';
  return null;
}
export async function tryOfflineRoute(
  stops: RoutePlace[],
  mode: TravelMode,
  signal: AbortSignal,
  preference = routingMode(),
): Promise<PlannedRoute | null> {
  const isMotorcycle = mode === 'motorcycle';
  if (isMotorcycle && preference === 'online')
    throw new Error('当前摩托车规划仅支持已下载的摩托车离线路网，不能改用汽车或自行车在线方案');
  if (preference === 'online') return null;
  const profile = offlineProfileForMode(mode);
  if (!profile) {
    if (preference === 'offline')
      throw new Error('当前没有离线自行车路网；请切换在线规划，或选择步行、驾车、摩托车');
    return null;
  }
  const matching = matchingGraphs(await listGraphs(), stops, profile);
  let lastRouteError: unknown;
  for (const item of matching) {
    signal.throwIfAborted();
    try {
      return await offlineRoute(await loadGraph(item.id), stops, signal);
    } catch (error) {
      signal.throwIfAborted();
      lastRouteError = error;
      if (preference === 'offline' && item === matching.at(-1)) throw error;
    }
  }
  if (isMotorcycle && lastRouteError instanceof Error) throw lastRouteError;
  if (isMotorcycle)
    throw new Error('没有覆盖起终点的摩托车离线路网，请先下载摩托车路网；不会用其他出行方式替代');
  if (preference === 'offline')
    throw new Error(`没有覆盖起终点和途经点的${profile === 'pedestrian' ? '步行' : profile === 'motorcycle' ? '摩托车' : '汽车'}离线路网，请先下载对应道路类型`);
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
