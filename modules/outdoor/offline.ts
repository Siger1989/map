import type { AddProtocolAction, RequestTransformFunction } from 'maplibre-gl';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import { TERRAIN_URL } from '../terrain/tiles.ts';
import { cachedMapFetch, offlineMapOnly } from './tileCache.ts';
export const TILEJSON = 'https://tiles.openfreemap.org/planet';
const CACHE = 'guanyun-trips-v1',
  INDEX = 'guanyun.trips.v1';
export type TripPackage = {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  urls: string[];
  done: number;
  bytes: number;
  createdAt: number;
  complete: boolean;
};
export function tripPackages(): TripPackage[] {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function putTrip(trip: TripPackage) {
  const list = tripPackages();
  const index = list.findIndex((t) => t.id === trip.id);
  if (index < 0) list.push(trip);
  else list[index] = trip;
  localStorage.setItem(INDEX, JSON.stringify(list));
}
export const offlineTransform: RequestTransformFunction = (url, kind) => {
  const u = new URL(url, window.location.origin);
  const supported =
    u.hostname === 'tiles.openfreemap.org' ||
    (u.origin === window.location.origin &&
      u.pathname.startsWith('/api/terrain/'));
  return {
    url:
      (supported || (offlineMapOnly() && /^https?:$/.test(u.protocol))) &&
      ['Source', 'Tile', 'Glyphs'].includes(kind ?? '')
        ? `tripcache://${encodeURIComponent(u.href)}`
        : url,
  };
};
export const offlineProtocol: AddProtocolAction = async (
  request,
  controller,
) => {
  const url = decodeURIComponent(request.url.slice('tripcache://'.length));
  const response = await cachedMapFetch(url, controller.signal);
  if (!response.ok) throw new Error(`地图数据暂缺 (${response.status})`);
  return {
    data:
      request.type === 'json'
        ? await response.json()
        : await response.arrayBuffer(),
  };
};
const tileX = (lng: number, z: number) =>
  Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) =>
  Math.floor(
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z,
  );
export function planBounds(points: Coordinate[]): TripPackage['bounds'] {
  if (!points.length || !points.every(coordinate))
    throw new Error('请先选择有效路线或地图位置');
  let west = 180,
    south = 85,
    east = -180,
    north = -85;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (east - west > 2 || north - south > 2)
    throw new Error('范围过大，请分成较短行程下载');
  const padding =
    0.02 / Math.max(0.1, Math.cos((((north + south) / 2) * Math.PI) / 180));
  return [
    Math.max(-180, west - padding),
    Math.max(-85, south - 0.02),
    Math.min(179.999, east + padding),
    Math.min(85, north + 0.02),
  ];
}
export function regionTiles(
  bounds: TripPackage['bounds'],
  maxzoom: number,
  template: string,
): string[] {
  const urls: string[] = [];
  for (let z = 0; z <= maxzoom; z++) {
    const n = 2 ** z;
    for (
      let x = Math.max(0, tileX(bounds[0], z));
      x <= Math.min(n - 1, tileX(bounds[2], z));
      x++
    )
      for (
        let y = Math.max(0, tileY(bounds[3], z));
        y <= Math.min(n - 1, tileY(bounds[1], z));
        y++
      ) {
        urls.push(
          template
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y)),
        );
        if (urls.length > 700)
          throw new Error('详细瓦片超过 700 张，请缩小范围或拆分行程');
      }
  }
  return urls;
}
export async function prepareTrip(
  name: string,
  points: Coordinate[],
  signal: AbortSignal,
): Promise<TripPackage> {
  return prepareRegion(name, planBounds(points), signal, 14);
}

export function validateRegion(bounds: TripPackage['bounds']) {
  const [w, s, e, n] = bounds;
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || w < -180 || e > 180 || s < -85 || n > 85 || w >= e || s >= n) throw new Error('请选择有效区域，暂不支持跨日期变更线');
  if (e - w > 2 || n - s > 2) throw new Error('范围过大，请缩小地图选区');
  return [...bounds] as TripPackage['bounds'];
}
export function regionEstimate(bounds: TripPackage['bounds'], zoom: number) {
  validateRegion(bounds);
  if (![10, 12, 14].includes(zoom)) throw new Error('请选择有效清晰度');
  return 257 + regionTiles(bounds, zoom, 'map/{z}/{x}/{y}').length + regionTiles(bounds, Math.min(12, zoom), 'dem/{z}/{x}/{y}').length;
}
export async function prepareRegion(name: string, selected: TripPackage['bounds'], signal: AbortSignal, zoom = 14): Promise<TripPackage> {
  const bounds = validateRegion(selected);
  regionEstimate(bounds, zoom);
  if (tripPackages().length >= 8)
    throw new Error('已达 8 个离线包，请先移除不用的包');
  const cache = await caches.open(CACHE);
  const cached = await cache.match(TILEJSON);
  const response =
    cached ??
    (await fetch(TILEJSON, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    }));
  if (!response.ok) throw new Error('开源地图源暂不可达，请联网重试');
  const json = (await response.clone().json()) as { tiles?: unknown[] };
  const template = json.tiles?.[0];
  if (
    typeof template !== 'string' ||
    !template.startsWith('https://tiles.openfreemap.org/')
  )
    throw new Error('地图源地址不支持离线');
  const urls = [
    TILEJSON,
    ...regionTiles(bounds, zoom, template),
    ...regionTiles(bounds, Math.min(12, zoom), window.location.origin + TERRAIN_URL),
  ];
  // Chinese labels may use any BMP glyph; retain the complete font ranges.
  for (let start = 0; start < 65536; start += 256)
    urls.push(
      `https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/${start}-${start + 255}.pbf`,
    );
  await cache.put(TILEJSON, response);
  const trip: TripPackage = {
    id: crypto.randomUUID(),
    name: name.slice(0, 60),
    bounds,
    urls: [...new Set(urls)],
    done: 0,
    bytes: 0,
    createdAt: Date.now(),
    complete: false,
  };
  putTrip(trip);
  return trip;
}
export async function downloadTrip(
  trip: TripPackage,
  signal: AbortSignal,
  progress: (t: TripPackage) => void,
) {
  const cache = await caches.open(CACHE);
  let cursor = 0,
    done = 0,
    bytes = 0,
    failed = 0;
  let lastUpdate = 0;
  const update = (force = false) => {
    if (!force && Date.now() - lastUpdate < 250) return;
    lastUpdate = Date.now();
    const next = { ...trip, done, bytes, complete: done === trip.urls.length };
    putTrip(next);
    progress(next);
  };
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < trip.urls.length && !signal.aborted) {
        const url = trip.urls[cursor++];
        try {
          const cached = await cache.match(url);
          const response =
            cached ??
            (await fetch(url, {
              signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            }));
          if (!response.ok) throw new Error('下载失败');
          const length = (await response.clone().arrayBuffer()).byteLength;
          if (length > 8 * 1024 * 1024 || bytes + length > 180 * 1024 * 1024)
            throw new Error('离线包超出 180 MB');
          bytes += length;
          try {
            if (!cached) await cache.put(url, response);
            done++;
          } catch (error) {
            bytes -= length;
            throw error;
          }
        } catch {
          failed++;
        }
        update();
      }
    }),
  );
  update(true);
  if (signal.aborted) throw new Error('下载已暂停，可稍后继续');
  if (failed)
    throw new Error(`${trip.urls.length - done} 项未下载，点击继续补齐`);
}
export async function verifyTrip(trip: TripPackage) {
  const cache = await caches.open(CACHE);
  let done = 0,
    bytes = 0;
  for (const url of trip.urls) {
    const response = await cache.match(url);
    if (response) {
      done++;
      bytes += (await response.arrayBuffer()).byteLength;
    }
  }
  const checked = { ...trip, done, bytes, complete: done === trip.urls.length };
  putTrip(checked);
  return checked;
}
export async function removeTrip(trip: TripPackage) {
  const list = tripPackages().filter((t) => t.id !== trip.id),
    keep = new Set(list.flatMap((t) => t.urls)),
    cache = await caches.open(CACHE);
  for (const url of trip.urls) if (!keep.has(url)) await cache.delete(url);
  localStorage.setItem(INDEX, JSON.stringify(list));
}
