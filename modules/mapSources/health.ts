import type { MapSource } from './types.ts';
import { fetchOnlineMapTile } from './tileTransport.ts';
import { isKnownNoImageryBytes, isNoImageryResponse } from './noImageryTile.ts';
import { renderOvmapTileAddress } from './ovmapTemplates.ts';
import { fromWgs84, type RasterDatum } from './coordinates.ts';

export type MapSourceHealthStatus =
  | 'ok' | 'partial' | 'missing' | 'authorization' | 'dns' | 'tls'
  | 'timeout' | 'http' | 'invalid' | 'unknown' | 'cancelled';

export type MapSourceHealthResult = {
  status: MapSourceHealthStatus;
  message: string;
  successes: number;
  missing: number;
  failures: number;
  sampled: number;
  sourceName?: string;
  testedZoom?: number;
  elapsedMs?: number;
  testedAt?: string;
  scope?: 'representative-tiles' | 'base-layer-only';
};

const MAX_SAMPLES = 3;
const MAX_ZOOM = 24;
const TILE_TIMEOUT_MS = 5_000;
const RESULT_MESSAGES: Record<MapSourceHealthStatus, string> = {
  ok: '当前位置图源可正常读取影像',
  partial: '当前位置图源部分瓦片可读，部分无覆盖或失败',
  missing: '当前位置所测瓦片均无影像覆盖',
  authorization: '图源服务拒绝访问，请核对授权或访问范围',
  dns: '图源域名解析失败',
  tls: '图源 HTTPS 安全连接失败',
  timeout: '图源请求超时',
  http: '图源服务器返回错误响应',
  invalid: '图源返回内容为空或不是有效地图影像',
  unknown: '浏览器无法读取图源响应，具体网络原因未知',
  cancelled: '图源测试已取消',
};

type TileOutcome = 'ok' | 'missing' | 'authorization' | 'dns' | 'tls' | 'timeout' | 'http' | 'invalid' | 'unknown';

/** Probe a few tiles around the current center. It bypasses tile caches and never changes the map. */
export async function probeMapSourceHealth(
  source: MapSource,
  center: [longitude: number, latitude: number],
  cameraZoom: number,
  signal?: AbortSignal,
  datum: RasterDatum = source?.datum ?? 'wgs84',
): Promise<MapSourceHealthResult> {
  const startedAt = Date.now();
  const sourceName = safeSourceName(source?.name);
  if (!source || source.kind !== 'online') return result('unknown', 0, 0, 0, 0, sourceName, undefined, startedAt);
  if (!center.every(Number.isFinite) || Math.abs(center[1]) > 90) return result('unknown', 0, 0, 0, 0, sourceName, undefined, startedAt);
  const layers = source.ovmap?.layers;
  const templates = layers?.[0]?.tiles ?? source.tiles ?? [];
  if (!templates.length) return result('unknown', 0, 0, 0, 0, sourceName, undefined, startedAt);
  const minZoom = layers?.[0]?.minzoom ?? source.minzoom;
  const maxZoom = layers?.[0]?.maxzoom ?? source.maxzoom;
  if (minZoom > MAX_ZOOM) return result('unknown', 0, 0, 0, 0, sourceName, undefined, startedAt);
  const z = Math.max(minZoom, Math.min(maxZoom, MAX_ZOOM, Math.floor(cameraZoom)));
  const probeCenter = fromWgs84(center[0], center[1], datum);
  const centerTile = tileXY(probeCenter[0], probeCenter[1], z);
  const side = 2 ** z;
  const targets = [centerTile, [Math.min(side - 1, centerTile[0] + 1), centerTile[1]] as const,
    [centerTile[0], Math.min(side - 1, centerTile[1] + 1)] as const].slice(0, MAX_SAMPLES);
  const outcomes: TileOutcome[] = [];
  for (const [x, y] of targets) {
    if (signal?.aborted) return result('cancelled', outcomes.filter(v => v === 'ok').length,
      outcomes.filter(v => v === 'missing').length, outcomes.filter(v => v !== 'ok' && v !== 'missing').length, outcomes.length, sourceName, z, startedAt);
    try {
      const url = source.ovmap?.layers?.length
        ? renderOvmapTileAddress(templates[(x + y) % templates.length], z, x, y, source.scheme ?? 'xyz')
        : renderTemplate(templates[(x + y) % templates.length], source, z, x, y);
      const bounded = AbortSignal.timeout(TILE_TIMEOUT_MS);
      const requestSignal = signal ? AbortSignal.any([signal, bounded]) : bounded;
      const response = await fetchOnlineMapTile(url, requestSignal);
      if (response.status === 401 || response.status === 403) { outcomes.push('authorization'); continue; }
      const transportCode = response.headers.get('X-Shantu-Tile-Error') ?? '';
      if (transportCode === 'dns' || transportCode === 'tls' || transportCode === 'timeout') { outcomes.push(transportCode); continue; }
      if (isNoImageryResponse(response)) { outcomes.push('missing'); continue; }
      if (!response.ok) { outcomes.push(response.status === 202 ? 'unknown' : 'http'); continue; }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (await isKnownNoImageryBytes(bytes)) { outcomes.push('missing'); continue; }
      outcomes.push(await isValidImage(bytes) ? 'ok' : 'invalid');
    } catch (error) {
      if (signal?.aborted) return result('cancelled', outcomes.filter(v => v === 'ok').length,
        outcomes.filter(v => v === 'missing').length, outcomes.filter(v => v !== 'ok' && v !== 'missing').length, outcomes.length, sourceName, z, startedAt);
      outcomes.push(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'unknown');
    }
  }
  const successes = outcomes.filter(v => v === 'ok').length;
  const missing = outcomes.filter(v => v === 'missing').length;
  const failures = outcomes.length - successes - missing;
  const sampled = outcomes.length;
  let status: MapSourceHealthStatus;
  if (successes && !failures && !missing) status = 'ok';
  else if (successes) status = 'partial';
  else if (outcomes.includes('authorization')) status = 'authorization';
  else if (outcomes.includes('dns')) status = 'dns';
  else if (outcomes.includes('tls')) status = 'tls';
  else if (outcomes.includes('timeout')) status = 'timeout';
  else if (outcomes.includes('http')) status = 'http';
  else if (outcomes.includes('invalid')) status = 'invalid';
  else if (missing === sampled && sampled > 0) status = 'missing';
  else status = 'unknown';
  return result(status, successes, missing, failures, sampled, sourceName, z, startedAt,
    layers && layers.length > 1 ? 'base-layer-only' : 'representative-tiles');
}

function result(status: MapSourceHealthStatus, successes: number, missing: number, failures: number, sampled: number,
  sourceName: string, testedZoom: number | undefined, startedAt: number, scope?: MapSourceHealthResult['scope']): MapSourceHealthResult {
  return { status, message: RESULT_MESSAGES[status], successes, missing, failures, sampled, sourceName,
    ...(testedZoom === undefined ? {} : { testedZoom }), elapsedMs: Date.now() - startedAt, testedAt: new Date(startedAt).toISOString(), scope };
}

function safeSourceName(name?: string): string {
  const value = (name ?? '当前图源').replace(/https?:\/\/\S+/gi, '[已隐藏地址]').replace(/\b(key|token|secret|api[_-]?key)=\S+/gi, '$1=[已隐藏]');
  return value.slice(0, 80);
}

function tileXY(longitude: number, latitude: number, zoom: number): readonly [number, number] {
  const n = 2 ** zoom;
  const lon = ((longitude + 180) % 360 + 360) % 360 - 180;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = Math.floor((lon + 180) / 360 * n);
  const rad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

function renderTemplate(template: string, source: MapSource, z: number, x: number, y: number): string {
  const row = source.scheme === 'tms' ? 2 ** z - y - 1 : y;
  const world = 40_075_016.68557849;
  const n = 2 ** z;
  const bbox = [x / n * world - world / 2, world / 2 - (y + 1) / n * world,
    (x + 1) / n * world - world / 2, world / 2 - y / n * world].join(',');
  return template.replace(/\{TileMatrix\}/gi, String(z)).replace(/\{TileCol\}/gi, String(x))
    .replace(/\{TileRow\}/gi, String(row)).replace(/\{z\}/gi, String(z)).replace(/\{x\}/gi, String(x))
    .replace(/\{y\}/gi, String(row)).replace(/\{ratio\}/gi, '').replace(/\{bbox-epsg-3857\}/gi, bbox);
}

async function isValidImage(bytes: Uint8Array): Promise<boolean> {
  if (!bytes.byteLength || typeof createImageBitmap !== 'function') return false;
  let bitmap: ImageBitmap | undefined;
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    bitmap = await createImageBitmap(new Blob([copy.buffer as ArrayBuffer]));
    return bitmap.width > 0 && bitmap.height > 0;
  } catch { return false; }
  finally { bitmap?.close(); }
}
