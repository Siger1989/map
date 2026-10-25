import { nativeRouteOffline, canUseNativeRouteDownload, downloadNative, applyNativeProgress, isNativeOfflineAvailable, nativeOfflineAvailableBytes, nativeOfflineVerify, nativeOfflineRemove } from './nativeOffline.ts';
import type { AddProtocolAction, RequestTransformFunction } from 'maplibre-gl';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import { TERRAIN_URL } from '../terrain/tiles.ts';
import { cachedMapFetch, offlineMapOnly } from './tileCache.ts';
import { tdtIdentity, resourceCacheKey, resourceFetchUrl, validateTileResponse } from './tiandituCache.ts';
import { downloadBounds, downloadTiles, MAX_DOWNLOAD_RESOURCES, type DownloadArea } from './downloadPlan.ts';
import type { TiandituLayer } from '../cartography/tianditu.ts';
import type { LayerSettings } from '../map/types';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy.ts';
import { readMap } from '../mapSources/storage.ts';
import type { MapSource } from '../mapSources/types.ts';
import { validateImportedDownloadSource, validateImportedDownloadUrls, assertImportedDownloadBudget } from './importedRouteDownload.ts';
import { planImportedRouteDownloadAsync } from './asyncImportedRoutePlan.ts';
export { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from './offlineDownloadPolicy.ts';
import { planBounds } from '../offlineRouting/routeBounds.ts';
import { tripPackages, putTrip as persistTripIndex, persistTripManifest, loadTripManifest, removeTripIndex, removeTripManifest, hydrateTripPackages } from './tripStorage.ts';
export { tripPackages } from './tripStorage.ts';
export { planBounds } from '../offlineRouting/routeBounds.ts';
export const TILEJSON = 'https://tiles.openfreemap.org/planet';
const CACHE = 'guanyun-trips-v1';
export type TripPackage = {
  manifest?: boolean;
  urlCount?: number;
  native?: boolean;
  provider?: 'tianditu' | 'openfreemap' | 'imported';
  sourceId?: string;
  sourceName?: string;
  datum?: MapSource['datum'];
  layers?: TiandituLayer[];
  zoom?: number;
  bufferKm?: number;
  detailCorridor?: boolean;
  routeNames?: string[];
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
export type DownloadProvider = 'tianditu' | 'openfreemap';
export function mapDownloadPlan(area: DownloadArea, settings: LayerSettings, provider: DownloadProvider, zoom: number) {
  if (provider === 'tianditu') throw new Error(TIANDITU_OFFLINE_DISABLED);
  const layers: TiandituLayer[] = [];
  if (![12,14,16,18].includes(zoom) || zoom > 14) throw new Error('请选择此图源支持的清晰度');
  const tiles = downloadTiles(area, zoom, MAX_DOWNLOAD_RESOURCES, area.kind === 'route' && zoom > 14);
  const terrain = settings.terrain ? downloadTiles(area, Math.min(12,zoom)) : [];
  const count = tiles.length + 257 + terrain.length;
  if(count>MAX_DOWNLOAD_RESOURCES) throw new Error('资源超过 2 万项，请降低清晰度或范围');
  const estimatedBytes = tiles.length * 26000 + terrain.length*16000 + 8000000;
  if(estimatedBytes>1024**3) throw new Error('预计超过 1 GB，请降低清晰度或范围');
  return { layers, tiles, terrain, count, estimatedBytes, bounds: downloadBounds(area) };
}
export async function prepareMapPackage(name: string, area: DownloadArea, settings: LayerSettings, provider: DownloadProvider, zoom: number, signal: AbortSignal): Promise<TripPackage> {
  if (provider === 'tianditu') throw new Error(TIANDITU_OFFLINE_DISABLED);
  const plan=mapDownloadPlan(area,settings,provider,zoom);
  if(tripPackages().length>=8)throw new Error('已达 8 个离线包，请先移除不用的包');
  const estimate=await navigator.storage?.estimate?.();
  if(estimate?.quota && estimate.quota-(estimate.usage??0)<plan.estimatedBytes*1.15)throw new Error('可用存储空间不足，请降低清晰度或清理旧包');
  const terrain=plan.terrain.map(t=>(window.location.origin+TERRAIN_URL).replace('{z}',String(t.z)).replace('{x}',String(t.x)).replace('{y}',String(t.y)));
  const response=await fetch(TILEJSON,{signal});
  if(!response.ok)throw new Error('开源地图源暂不可达');
  const json=await response.clone().json() as {tiles?:unknown[]}; const template=json.tiles?.[0];
  if(typeof template!=='string'||!template.startsWith('https://tiles.openfreemap.org/'))throw new Error('地图源地址不支持离线');
  await (await caches.open(CACHE)).put(TILEJSON,response);
  const urls=[TILEJSON,...plan.tiles.map(t=>template.replace('{z}',String(t.z)).replace('{x}',String(t.x)).replace('{y}',String(t.y)))];
  for(let start=0;start<65536;start+=256)urls.push(`https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/${start}-${start+255}.pbf`);
  const trip: TripPackage={id:crypto.randomUUID(),name:name.trim().slice(0,60)||'离线地图',bounds:plan.bounds,urls:[...new Set([...urls,...terrain])],done:0,bytes:0,createdAt:Date.now(),complete:false,provider,layers:plan.layers,zoom,detailCorridor:area.kind==='route'&&zoom>14,bufferKm:area.kind==='route'?area.bufferKm:undefined,
    display:{satellite:settings.satellite,tiandituBase:settings.tiandituBase,tiandituLabels:settings.tiandituLabels,tiandituBoundaries:settings.tiandituBoundaries,terrain:settings.terrain,labels:settings.labels,roads:settings.roads,roadsOpacity:settings.roadsOpacity,imageryMode:'detail',offlineBasemap:provider==='openfreemap',offlineMaxZoom:zoom,rasterLevel:null}};
  putTrip(trip);return trip;
}

export async function prepareImportedRoutePackage(
  name: string,
  area: Extract<DownloadArea, { kind: 'route' }>,
  source: MapSource,
  zoom: number,
  signal: AbortSignal,
  routeNames?: readonly string[],
): Promise<TripPackage> {
  signal.throwIfAborted();
  if (routeNames && routeNames.length > 2000) throw new Error('路线名称数量不能超过 2000');
  const names = [...new Set((routeNames ?? [name])
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().slice(0, 60))
    .filter(Boolean))];
  if (!names.length) {
    const fallback = name.trim().slice(0, 60);
    if (fallback) names.push(fallback);
  }
  if (source.kind !== 'online') throw new Error('仅支持已导入的在线图源');
  const stored = await readMap(source.id);
  if (!stored || stored.kind !== 'online') throw new Error('此导入图源已移除，请重新选择');
  const signature = (item: MapSource) => JSON.stringify([item.tiles, item.scheme ?? 'xyz', item.tileSize, item.minzoom, item.maxzoom, item.bounds, item.ovmap?.layers]);
  if (signature(source) !== signature(stored)) throw new Error('导入图源已变化，请重新选择后再下载');
  if (tripPackages().length >= 8) throw new Error('已达 8 个离线包，请先移除不用的包');
  const plan = await planImportedRouteDownloadAsync(area, source, zoom, { signal });
  const routeBridge = nativeRouteOffline();
  let availableBytes: number | undefined;
  if (routeBridge || isNativeOfflineAvailable()) {
    const available = await nativeOfflineAvailableBytes();
    if (typeof available !== 'number' || !Number.isFinite(available))
      throw new Error('无法确认本机离线存储空间，请检查设备存储后重试');
    availableBytes = Math.max(0, available);
  } else {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota) availableBytes = Math.max(0, estimate.quota - (estimate.usage ?? 0));
  }
  if (availableBytes !== undefined && availableBytes < plan.estimatedBytes * 1.15)
    throw new Error('可用存储空间不足，请降低清晰度或清理旧包');
  signal.throwIfAborted();
  const trip: TripPackage = {
    id: crypto.randomUUID(),
    name: `${name.trim().slice(0, 30) || '路线'} · ${stored.name}`.slice(0, 60),
    bounds: plan.bounds,
    urls: plan.urls,
    done: 0,
    bytes: 0,
    createdAt: Date.now(),
    complete: false,
    provider: 'imported',
    routeNames: names,
    sourceId: stored.id,
    sourceName: stored.name,
    datum: source.datum ?? 'wgs84',
    zoom,
    bufferKm: area.bufferKm,
    display: {
      satellite: false,
      offlineBasemap: false,
      roads: false,
      labels: false,
      terrain: false,
      rasterLevel: null,
      rasterDatums: { [`custom:${stored.id}`]: source.datum ?? 'wgs84' },
    },
  };
  await persistTripManifest(trip);
  return trip;
}
const removingTrips = new Set<string>();
export function putTrip(trip: TripPackage) {
  if (!removingTrips.has(trip.id)) persistTripIndex(trip);
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
      (supported || (kind === 'Tile' && /^https?:$/.test(u.protocol)) || (offlineMapOnly() && /^https?:$/.test(u.protocol))) &&
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
  const response = await cachedMapFetch(url, controller.signal, undefined, true);
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

async function validateImportedTileResponse(response: Response) {
  if (!response.ok)
    throw Object.assign(new Error(`图源请求失败 (${response.status})`), { status: response.status });
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const png = bytes.length >= 8 && bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  const gif = bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  const avif = bytes.length >= 16 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12));
  if (!(png || jpeg || webp || gif || avif)) throw new Error('图源未返回有效地图影像，下载已暂停');
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('单张地图瓦片超过 8 MB，下载已暂停');
  return bytes.byteLength;
}

export async function downloadTrip(
  trip: TripPackage,
  signal: AbortSignal,
  progress: (t: TripPackage) => void,
  fetchImported?: (url: string, signal: AbortSignal) => Promise<Response>,
) {
  trip = await loadTripManifest(trip);
  if (!canDownloadTrip(trip)) throw new Error(TIANDITU_OFFLINE_DISABLED);
  if (trip.provider === 'imported') {
    if (!trip.sourceId || !trip.sourceName || !trip.urls.length) throw new Error('导入图源下载包信息不完整');
    const source = await readMap(trip.sourceId);
    if (!source || source.kind !== 'online') throw new Error('此离线包的导入图源已移除，无法继续下载');
    validateImportedDownloadSource(source);
    validateImportedDownloadUrls(trip.urls);
    if (canUseNativeRouteDownload(trip)) { await downloadNative(trip,signal,next=>{putTrip(next);progress(next);});return; }
    if (!fetchImported) throw new Error('导入图源下载通道暂不可用');
  } else if (isNativeOfflineAvailable()) { await downloadNative(trip,signal,next=>{putTrip(next);progress(next);});return; }
  const cache = await caches.open(CACHE);
  let cursor = 0,
    done = 0,
    bytes = 0,
    reservedBytes = 0,
    failed = 0;
  const pending:string[]=[];
  for(const url of trip.urls) {
    if(signal.aborted)throw Error('下载已暂停，可稍后继续');
    const hit=await cache.match(resourceCacheKey(url));
    if(hit?.ok){try{bytes+=trip.provider === 'imported' ? await validateImportedTileResponse(hit) : await validateTileResponse(url,hit);done++;continue;}catch{await cache.delete(resourceCacheKey(url));}}
    pending.push(url);
  }
  if (trip.provider === 'imported') assertImportedDownloadBudget(bytes);
  let fatal = '';
  let lastUpdate = 0;
  const update = (force = false) => {
    if (!force && Date.now() - lastUpdate < 500) return;
    lastUpdate = Date.now();
    const next = { ...trip, done, bytes, complete: done === trip.urls.length };
    putTrip(next);
    progress(next);
  };
  update(true);
  const stopReason = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/单张地图图像超过 8MB/.test(message)) return message;
    if (trip.provider === 'imported') {
      const status = Number((error as { status?: unknown })?.status) || Number(/\((\d{3})\)/.exec(message)?.[1]);
      if ([401, 403, 429].includes(status)) return '图源授权或服务额度受限，下载已暂停；已有瓦片保留，可稍后手动继续';
      if (signal.aborted || message === '图源请求已取消' || /aborted|abort/i.test(message)) return '下载已暂停，可稍后继续';
      if (/离线包达到|存储空间|quota/i.test(message)) return message;
      return '图源请求失败，下载已暂停；已下载瓦片保留，可稍后手动继续';
    }
    if (/天地图|1 GB|quota|storage/i.test(message)) return message;
    if (trip.provider === 'tianditu' && !signal.aborted) return '下载连接中断或资源暂缺，已暂停；联网后可继续补齐';
    return '';
  };
  const worker = async () => {
      while (cursor < pending.length && !signal.aborted && !fatal) {
        const url = pending[cursor++];
        try {
          const cached = await cache.match(resourceCacheKey(url));
          const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
          const response = cached ?? (trip.provider === 'imported'
            ? await fetchImported!(url, requestSignal)
            : await fetch(resourceFetchUrl(url), { signal: requestSignal }));
          const length = trip.provider === 'imported' ? await validateImportedTileResponse(response) : await validateTileResponse(url, response);
          if (length > 8 * 1024 * 1024)
            throw new Error('单张地图图像超过 8MB 上限，下载已暂停');
          if (trip.provider === 'imported') assertImportedDownloadBudget(bytes + reservedBytes + length);
          else if (bytes + reservedBytes + length > 1024 * 1024 * 1024)
            throw new Error('离线包达到 1 GB 上限，已暂停；请降低清晰度');
          // Reserve before the async write so concurrent workers cannot all pass the same budget check.
          reservedBytes += length;
          try {
            if (!cached) await cache.put(resourceCacheKey(url), response);
            bytes += length;
            done++;
          } catch (error) {
            throw error;
          } finally { reservedBytes -= length; }
        } catch (e) {
          failed++;
          fatal ||= stopReason(e);
        }
        try { update(); } catch (error) { fatal ||= stopReason(error); }
      }
  };
  const concurrency = trip.provider === 'imported' ? 16 : 3;
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
  let checkpointError = '';
  try { update(true); } catch (error) { checkpointError = (error as Error).message; }
  if (signal.aborted) throw new Error('下载已暂停，可稍后继续');
  if (fatal) throw new Error(fatal);
  if (checkpointError) throw new Error(checkpointError);
  if (failed)
    throw new Error(`${trip.urls.length - done} 项未下载，点击继续补齐`);
}
export async function verifyTrip(trip: TripPackage) {
  trip = await loadTripManifest(trip);
  if(trip.native && isNativeOfflineAvailable()){const checked=applyNativeProgress(trip,await nativeOfflineVerify(trip.id));putTrip(checked);return checked;}
  const cache = await caches.open(CACHE);
  let done = 0,
    bytes = 0;
  for (const url of trip.urls) {
    const response = await cache.match(resourceCacheKey(url));
    if (response?.ok) {
      try {
        bytes += trip.provider === 'imported'
          ? await validateImportedTileResponse(response)
          : (await response.arrayBuffer()).byteLength;
        done++;
      } catch {
        // Invalid imported response bodies do not count as cached map tiles.
      }
    }
  }
  const checked = { ...trip, done, bytes, complete: done === trip.urls.length };
  putTrip(checked);
  return checked;
}
export async function removeTrip(trip: TripPackage) {
  removingTrips.add(trip.id);
  try {
    const allTrips = await hydrateTripPackages();
    trip = await loadTripManifest(trip);
    if(trip.native && isNativeOfflineAvailable() && !await nativeOfflineRemove(trip.id))throw Error('缓存移除失败；下载尚未停止或存储暂不可用，请稍后重试');
    const keep = new Set(allTrips.filter(t=>t.id!==trip.id).flatMap(t=>t.urls.map(resourceCacheKey)));
    const cache = await caches.open(CACHE);
    for(const url of trip.urls) if(!keep.has(resourceCacheKey(url)))await cache.delete(resourceCacheKey(url));
    // Re-read after awaits: another package may have received progress meanwhile.
    removeTripIndex(trip.id);
    if (trip.manifest) {
      try { await removeTripManifest(trip.id); }
      catch (error) {
        // Keep the package recoverable if its IndexedDB manifest could not be removed.
        persistTripIndex(trip);
        throw error;
      }
    }
    if(localStorage.getItem('shantu.offline-package.v1')===trip.id)localStorage.removeItem('shantu.offline-package.v1');
  } finally { removingTrips.delete(trip.id); }
}
