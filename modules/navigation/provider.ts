import {
  coordinate,
  metresBetween,
  type Coordinate,
  type PlannedRoute,
  type RoutePlace,
  type TravelMode,
} from './types.ts';
import { MAX_ROUTE_STOPS } from './stops.ts';

// Provider boundary: public demonstration services for this small test build.
// Production clients should use an operated backend with application-wide limits.
export const NAVIGATION_SERVICES = {
  route: 'https://valhalla1.openstreetmap.de/route',
  search: 'https://photon.komoot.io/api/',
};
const cache = new Map<string, { time: number; data: unknown }>();
const nextRequestAt = new Map<string, number>();
async function requestJSON(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < 15 * 60_000) return hit.data;
  const service = new URL(url).host;
  const wait = Math.max(0, (nextRequestAt.get(service) ?? 0) - Date.now());
  nextRequestAt.set(service, Date.now() + wait + 1100);
  if (wait)
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, wait);
      signal.addEventListener('abort', cancel, { once: true });
    });
  signal.throwIfAborted();
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  if (response.status === 429) throw new Error('服务请求较多，请稍后再试。');
  if (!response.ok)
    throw new Error(
      response.status === 400
        ? '无法规划这两个地点之间的路线，请把起终点选在附近道路上。'
        : '路线或搜索服务暂不可用，请检查网络后重试。',
    );
  if (Number(response.headers.get('content-length')) > 4_000_000)
    throw new Error('返回内容过大，请分段规划。');
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('返回内容过大，请分段规划。');
  const data: unknown = JSON.parse(text);
  if (cache.size >= 24) cache.delete(cache.keys().next().value!);
  cache.set(url, { time: Date.now(), data });
  return data;
}
type RawStep = {
  distance?: unknown;
  duration?: unknown;
  name?: unknown;
  geometry?: { coordinates?: unknown };
  maneuver?: { type?: string; modifier?: string; exit?: number };
};
function instruction(step: RawStep) {
  const m = step.maneuver;
  const direction: Record<string, string> = {
    left: '左转',
    right: '右转',
    'slight left': '向左前方行进',
    'slight right': '向右前方行进',
    'sharp left': '向左急转',
    'sharp right': '向右急转',
    straight: '直行',
    uturn: '掉头',
  };
  let action = direction[m?.modifier ?? ''] ?? '继续行进';
  if (m?.type === 'depart') action = '出发';
  else if (m?.type === 'arrive') action = '到达终点';
  else if (m?.type === 'roundabout' || m?.type === 'rotary')
    action = `进入环岛${Number.isInteger(m.exit) ? `，从第 ${m.exit} 个出口驶出` : ''}`;
  else if (m?.type === 'merge') action = '并入道路';
  else if (m?.type === 'on ramp') action = '进入匝道';
  else if (m?.type === 'off ramp') action = '驶出匝道';
  const name = typeof step.name === 'string' ? step.name.slice(0, 160) : '';
  return `${action}${name && m?.type !== 'arrive' ? ` · ${name}` : ''}`;
}
const metric = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
function line(v: unknown, min = 2): Coordinate[] {
  if (
    !Array.isArray(v) ||
    v.length < min ||
    v.length > 100_000 ||
    !v.every(coordinate)
  )
    throw new Error('路线坐标无效，请重试。');
  return v.map((c) => [c[0], c[1]]);
}
export function normalizeRoute(input: unknown, mode: TravelMode): PlannedRoute {
  const raw = input as {
    code?: string;
    routes?: {
      geometry?: { type?: string; coordinates?: unknown };
      distance?: unknown;
      duration?: unknown;
      legs?: { steps?: RawStep[] }[];
    }[];
    waypoints?: { location?: unknown }[];
  };
  const route = raw?.routes?.[0];
  if (raw?.code !== 'Ok' || !route)
    throw new Error('没有找到可通行路线，请更换出行方式或起终点。');
  if (
    !metric(route.distance) ||
    !metric(route.duration) ||
    route.geometry?.type !== 'LineString'
  )
    throw new Error('路线数据不完整，请稍后重试。');
  const coordinates = line(route.geometry.coordinates);
  let elapsedSeconds = 0;
  const steps = (route.legs ?? [])
    .flatMap((leg, index) =>
      (leg.steps ?? []).map((step) => ({
        ...step,
        viaIndex: index < (route.legs?.length ?? 0) - 1 ? index + 1 : 0,
      })),
    )
    .map((step) => {
      if (!metric(step.distance) || !metric(step.duration))
        throw new Error('路线分段数据无效。');
      const result = {
        instruction:
          step.maneuver?.type === 'arrive' && step.viaIndex
            ? `到达途经点 ${step.viaIndex}`
            : instruction(step),
        distance: step.distance,
        duration: step.duration,
        elapsedSeconds,
        coordinates: line(step.geometry?.coordinates, 1),
      };
      elapsedSeconds += step.duration;
      return result;
    });
  return {
    mode,
    coordinates,
    distance: route.distance,
    duration: route.duration,
    steps,
    snapped: (raw.waypoints ?? []).map((p) => p.location).filter(coordinate),
    createdAt: Date.now(),
  };
}
export function routeURL(
  start: RoutePlace,
  end: RoutePlace,
  mode: TravelMode,
  via: RoutePlace[] = [],
) {
  const stops = [start, ...via, end];
  if (
    stops.length > MAX_ROUTE_STOPS ||
    !stops.every((p) => p && coordinate(p.coordinates)) ||
    !['auto', 'bicycle', 'pedestrian'].includes(mode)
  )
    throw new Error('地点或出行方式无效，最多支持 8 个途经点。');
  const distances = stops
    .slice(1)
    .map((p, i) => metresBetween(stops[i].coordinates, p.coordinates));
  if (distances.some((d) => d < 20))
    throw new Error('相邻地点太近，请间隔至少 20 米。');
  if (distances.reduce((sum, d) => sum + d, 0) > 500000)
    throw new Error('测试服务请分成总长 500 公里以内的行程规划。');
  const query = {
    locations: stops.map((p) => ({
      lon: p.coordinates[0],
      lat: p.coordinates[1],
      type: 'break',
      radius: 500,
    })),
    costing: mode,
    units: 'kilometers',
    format: 'osrm',
    shape_format: 'geojson',
  };
  return (
    NAVIGATION_SERVICES.route +
    '?json=' +
    encodeURIComponent(JSON.stringify(query))
  );
}
export async function planRoute(
  start: RoutePlace,
  end: RoutePlace,
  mode: TravelMode,
  signal: AbortSignal,
  via: RoutePlace[] = [],
) {
  const route = normalizeRoute(
    await requestJSON(routeURL(start, end, mode, via), signal),
    mode,
  );
  if (route.snapped.length !== via.length + 2)
    throw new Error('路线服务返回的途经点数量不一致，请重试。');
  return { ...route, stops: [start, ...via, end] };
}
export function normalizePlaces(input: unknown): RoutePlace[] {
  const raw = input as {
    features?: {
      geometry?: { coordinates?: unknown };
      properties?: Record<string, unknown>;
    }[];
  };
  if (!Array.isArray(raw?.features))
    throw new Error('地名搜索返回异常，请在地图选点。');
  return raw.features
    .flatMap((f) => {
      const c = f.geometry?.coordinates,
        p = f.properties;
      if (!coordinate(c) || !p || typeof p.name !== 'string') return [];
      const detail = [
        ...new Set(
          [p.country, p.state, p.city, p.district, p.street].filter(
            (x) => typeof x === 'string',
          ),
        ),
      ].join(' · ');
      return [
        {
          name: p.name.slice(0, 160),
          detail,
          coordinates: [c[0], c[1]] as Coordinate,
        },
      ];
    })
    .slice(0, 5);
}
export async function searchPlaces(
  query: string,
  near: Coordinate,
  signal: AbortSignal,
) {
  if (query.trim().length < 2)
    throw new Error('请输入至少两个字，或使用地图选点。');
  const params = new URLSearchParams({
    q: query.trim().slice(0, 120),
    limit: '5',
    lat: String(near[1]),
    lon: String(near[0]),
  });
  return normalizePlaces(
    await requestJSON(NAVIGATION_SERVICES.search + '?' + params, signal),
  );
}
