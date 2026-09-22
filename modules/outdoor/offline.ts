import { nativeOffline, downloadNative, applyNativeProgress } from './nativeOffline.ts';
import type { AddProtocolAction, RequestTransformFunction } from 'maplibre-gl';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import { TERRAIN_URL } from '../terrain/tiles.ts';
import { cachedMapFetch, offlineMapOnly } from './tileCache.ts';
import { tdtIdentity, tdtResource, resourceCacheKey, resourceFetchUrl, validateTileResponse } from './tiandituCache.ts';
import { downloadBounds, downloadTiles, MAX_DOWNLOAD_RESOURCES, type DownloadArea } from './downloadPlan.ts';
import { TIANDITU_LAYERS, tiandituLayers, type TiandituLayer } from '../cartography/tianditu.ts';
import { basemapConfiguration } from '../cartography/basemaps.ts';
import type { LayerSettings } from '../map/types';
export const TILEJSON = 'https://tiles.openfreemap.org/planet';
const CACHE = 'guanyun-trips-v1',
  INDEX = 'guanyun.trips.v1';
export type TripPackage = {
  native?: boolean;
  provider?: 'tianditu' | 'openfreemap';
  layers?: TiandituLayer[];
  zoom?: number;
  bufferKm?: number;
  detailCorridor?: boolean;
  display?: Partial<LayerSettings>;
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
export type DownloadProvider = 'tianditu' | 'openfreemap';
export function mapDownloadPlan(area: DownloadArea, settings: LayerSettings, provider: DownloadProvider, zoom: number) {
  const layers = provider === 'tianditu' ? tiandituLayers(settings) : [];
  const maximum = layers.length ? TIANDITU_LAYERS[layers[0]].maxzoom : 14;
  if (![12,14,16,18].includes(zoom) || zoom > maximum) throw new Error('请选择此图源支持的清晰度');
  const tiles = downloadTiles(area, zoom, Math.floor(MAX_DOWNLOAD_RESOURCES / Math.max(1,layers.length)), area.kind === 'route' && zoom > 14);
  const terrain = settings.terrain ? downloadTiles(area, Math.min(12,zoom)) : [];
  const count = (layers.length ? layers.reduce((n,l)=>n+tiles.filter(t=>t.z>=1&&t.z<=TIANDITU_LAYERS[l].maxzoom).length,0) : tiles.length+257) + terrain.length;
  if(count>MAX_DOWNLOAD_RESOURCES) throw new Error('资源超过 2 万项，请降低清晰度或范围');
  const estimatedBytes = tiles.length * (provider === 'tianditu' ? layers.reduce((n,l)=>n+(l==='img'?35000:l==='vec'||l==='ter'?18000:6000),0) : 26000) + terrain.length*16000 + (provider==='openfreemap'?8000000:0);
  if(estimatedBytes>1024**3) throw new Error('预计超过 1 GB，请降低清晰度或范围');
  return { layers, tiles, terrain, count, estimatedBytes, bounds: downloadBounds(area) };
}
export async function prepareMapPackage(name: string, area: DownloadArea, settings: LayerSettings, provider: DownloadProvider, zoom: number, signal: AbortSignal): Promise<TripPackage> {
  if(provider==='tianditu'&&!basemapConfiguration().domestic)throw new Error('未配置天地图 Key');
  const plan=mapDownloadPlan(area,settings,provider,zoom);
  if(tripPackages().length>=8)throw new Error('已达 8 个离线包，请先移除不用的包');
  const estimate=await navigator.storage?.estimate?.();
  if(estimate?.quota && estimate.quota-(estimate.usage??0)<plan.estimatedBytes*1.15)throw new Error('可用存储空间不足，请降低清晰度或清理旧包');
  const terrain=plan.terrain.map(t=>(window.location.origin+TERRAIN_URL).replace('{z}',String(t.z)).replace('{x}',String(t.x)).replace('{y}',String(t.y)));
  let urls: string[];
  if(provider==='tianditu')urls=plan.layers.flatMap(l=>plan.tiles.filter(t=>t.z>=1&&t.z<=TIANDITU_LAYERS[l].maxzoom).map(t=>tdtResource(l,t.z,t.x,t.y)));
  else {
    const response=await fetch(TILEJSON,{signal});
    if(!response.ok)throw new Error('开源地图源暂不可达');
    const json=await response.clone().json() as {tiles?:unknown[]}; const template=json.tiles?.[0];
    if(typeof template!=='string'||!template.startsWith('https://tiles.openfreemap.org/'))throw new Error('地图源地址不支持离线');
    await (await caches.open(CACHE)).put(TILEJSON,response);
    urls=[TILEJSON,...plan.tiles.map(t=>template.replace('{z}',String(t.z)).replace('{x}',String(t.x)).replace('{y}',String(t.y)))];
    for(let start=0;start<65536;start+=256)urls.push(`https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/${start}-${start+255}.pbf`);
  }
  const trip: TripPackage={id:crypto.randomUUID(),name:name.trim().slice(0,60)||'离线地图',bounds:plan.bounds,urls:[...new Set([...urls,...terrain])],done:0,bytes:0,createdAt:Date.now(),complete:false,provider,layers:plan.layers,zoom,detailCorridor:area.kind==='route'&&zoom>14,bufferKm:area.kind==='route'?area.bufferKm:undefined,
    display:{satellite:settings.satellite,tiandituBase:settings.tiandituBase,tiandituLabels:settings.tiandituLabels,tiandituBoundaries:settings.tiandituBoundaries,terrain:settings.terrain,labels:settings.labels,roads:settings.roads,roadsOpacity:settings.roadsOpacity,imageryMode:'detail',offlineBasemap:provider==='openfreemap',offlineMaxZoom:zoom,rasterLevel:null}};
  putTrip(trip);return trip;
}
export function putTrip(trip: TripPackage) {
  const list = tripPackages();
  const index = list.findIndex((t) => t.id === trip.id);
  if (index < 0) list.push(trip);
  else list[index] = trip;
  localStorage.setItem(INDEX, JSON.stringify(list));
}
export const offlineTransform: RequestTransformFunction = (url, kind) => {
  const u = new URL(url, window.location.origin);
  const supported =
    !!tdtIdentity(url) ||
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
  if(nativeOffline()) { await downloadNative(trip,signal,next=>{putTrip(next);progress(next);});return; }
  const cache = await caches.open(CACHE);
  let cursor = 0,
    done = 0,
    bytes = 0,
    failed = 0;
  const pending:string[]=[];
  for(const url of trip.urls) {
    if(signal.aborted)throw Error('下载已暂停，可稍后继续');
    const hit=await cache.match(resourceCacheKey(url));
    if(hit?.ok){try{bytes+=await validateTileResponse(url,hit);done++;continue;}catch{await cache.delete(resourceCacheKey(url));}}
    pending.push(url);
  }
  let fatal = '';
  let lastUpdate = 0;
  const update = (force = false) => {
    if (!force && Date.now() - lastUpdate < 250) return;
    lastUpdate = Date.now();
    const next = { ...trip, done, bytes, complete: done === trip.urls.length };
    putTrip(next);
    progress(next);
  };
  update(true);
  await Promise.all(
    Array.from({ length: trip.provider === 'tianditu' ? 2 : 3 }, async () => {
      while (cursor < pending.length && !signal.aborted && !fatal) {
        const url = pending[cursor++];
        try {
          const cached = await cache.match(resourceCacheKey(url));
          const response =
            cached ??
            (await fetch(resourceFetchUrl(url), {
              signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            }));
          const length = await validateTileResponse(url, response);
          if (length > 8 * 1024 * 1024 || bytes + length > 1024 * 1024 * 1024)
            throw new Error('离线包达到 1 GB 上限，已暂停；请降低清晰度');
          bytes += length;
          try {
            if (!cached) await cache.put(resourceCacheKey(url), response);
            done++;
          } catch (error) {
            bytes -= length;
            throw error;
          }
          if (!cached && trip.provider === 'tianditu') await new Promise(resolve => setTimeout(resolve, 350));
        } catch (e) {
          failed++;
          const message = (e as Error).message;
          if (/天地图|1 GB|quota|storage/i.test(message)) fatal = message;
          else if (trip.provider === 'tianditu' && !signal.aborted) fatal = '下载连接中断或资源暂缺，已暂停；联网后可继续补齐';
        }
        update();
      }
    }),
  );
  update(true);
  if (signal.aborted) throw new Error('下载已暂停，可稍后继续');
  if (fatal) throw new Error(fatal);
  if (failed)
    throw new Error(`${trip.urls.length - done} 项未下载，点击继续补齐`);
}
export async function verifyTrip(trip: TripPackage) {
  if(trip.native && nativeOffline()){const checked=applyNativeProgress(trip,JSON.parse(nativeOffline()!.offlineVerify(trip.id)));putTrip(checked);return checked;}
  const cache = await caches.open(CACHE);
  let done = 0,
    bytes = 0;
  for (const url of trip.urls) {
    const response = await cache.match(resourceCacheKey(url));
    if (response?.ok) {
      done++;
      bytes += (await response.arrayBuffer()).byteLength;
    }
  }
  const checked = { ...trip, done, bytes, complete: done === trip.urls.length };
  putTrip(checked);
  return checked;
}
export async function removeTrip(trip: TripPackage) {
  if(trip.native && nativeOffline() && !nativeOffline()!.offlineRemove(trip.id))throw Error('缓存移除失败，请暂停下载后重试');
  const list = tripPackages().filter((t) => t.id !== trip.id),
    keep = new Set(list.flatMap((t) => t.urls.map(resourceCacheKey))),
    cache = await caches.open(CACHE);
  for (const url of trip.urls) if (!keep.has(resourceCacheKey(url))) await cache.delete(resourceCacheKey(url));
  localStorage.setItem(INDEX, JSON.stringify(list));
}
