import { compileOsmGraph } from './osmGraph';
import { GRAPH_LIMITS, type RoutingBounds } from './types';
import { metresBetween } from '../navigation/types';
export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** One bounded region request; no automatic retry loop against public infrastructure. */
export async function downloadGraph(
  name: string,
  bounds: RoutingBounds,
  signal: AbortSignal,
) {
  const [w, s, e, n] = bounds,
    area =
      (metresBetween([w, s], [e, s]) * metresBetween([w, s], [w, n])) / 1e6;
  if (area > GRAPH_LIMITS.maximumAreaKm2)
    throw new Error('离线步行路网单区最多100km²，请分区下载');
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:40][maxsize:32000000];way[highway](${bbox})->.roads;( .roads; node(w.roads); rel(bw.roads)[type~"^restriction"];);out body;`;
  const response = await fetch(
    OVERPASS_ENDPOINT + '?' + new URLSearchParams({ data: query }),
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      credentials: 'omit',
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 429 || response.status === 504
        ? '路网服务繁忙，请稍后重试或导入离线路网文件'
        : '路网下载失败，请检查网络',
    );
  if (Number(response.headers.get('content-length')) > GRAPH_LIMITS.bytes)
    throw new Error('道路数据过大，请缩小区域');
  const text = await response.text();
  if (text.length > GRAPH_LIMITS.bytes)
    throw new Error('道路数据过大，请缩小区域');
  signal.throwIfAborted();
  return compileOsmGraph(JSON.parse(text), name, bounds, crypto.randomUUID());
}
