import { fetchOnlineMapTile } from '../mapSources/tileTransport.ts';

export type CloudFrame = { stamp: string; timeUTC: number };
export type SatelliteCloudBounds = [west: number, south: number, east: number, north: number];
export type SatelliteCloudImage = { blob: Blob; bounds: SatelliteCloudBounds };

const FRAME_LIST_URL = 'https://data.nsmc.org.cn/nsmcapi/v1/nsmc/image/animation/datatime/mongodb';
const WMS_GET_MAP_URL = 'https://data.nsmc.org.cn/NSMCAPI/v1/nsmc/image/wms/compose';
const FRAME_DATA_CODE = 'GEO_MULT_GBAL_L2_GGM_IRX_GLL_YYYYMMDD_HHmm_4000M.PNG';
const FRAME_CACHE_MS = 2 * 60 * 1000;
const DEFAULT_BOUNDS: SatelliteCloudBounds = [-180, -90, 180, 90];
const GLOBAL_IMAGE_BOUNDS: SatelliteCloudBounds = [-180, -90, 180, 90];

type FrameListPayload = {
  returnCode?: number;
  ds?: Array<{ dataDate?: unknown; dataTime?: unknown }>;
};

type FrameListOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
};

type CloudImageOptions = {
  fetchImpl?: (url: string, signal: AbortSignal) => Promise<Response>;
  inspectImage?: (blob: Blob) => Promise<boolean>;
};

let cachedFrames: { expiresAt: number; frames: CloudFrame[] } | undefined;
const completeImages = new Map<string, SatelliteCloudImage>();
const pendingImages = new Map<string, Promise<SatelliteCloudImage>>();

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function stampForUTC(timeUTC: number): string {
  const date = new Date(timeUTC);
  return `${date.getUTCFullYear().toString().padStart(4, '0')}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date.getUTCDate().toString().padStart(2, '0')}${date.getUTCHours().toString().padStart(2, '0')}${date.getUTCMinutes().toString().padStart(2, '0')}`;
}

function parseFrame(value: { dataDate?: unknown; dataTime?: unknown }): CloudFrame | undefined {
  if (typeof value.dataDate !== 'string' || typeof value.dataTime !== 'string') return;
  const date = value.dataDate;
  const time = value.dataTime;
  if (!/^\d{8}$/.test(date) || !/^\d{4}(?:\d{2})?$/.test(time)) return;
  const stamp = `${date}${time.slice(0, 4)}`;
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const timeUTC = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(timeUTC);
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) return;
  return { stamp, timeUTC };
}

export function parseSatelliteCloudFrames(payload: unknown): CloudFrame[] {
  if (!payload || typeof payload !== 'object') throw new Error('卫星云图时间列表格式无效');
  const data = payload as FrameListPayload;
  if (data.returnCode !== undefined && data.returnCode !== 0) {
    throw new Error('国家卫星气象中心时间列表暂不可用');
  }
  if (!Array.isArray(data.ds)) throw new Error('卫星云图时间列表缺少时次数据');
  const byStamp = new Map<string, CloudFrame>();
  for (const item of data.ds) {
    if (!item || typeof item !== 'object') continue;
    const frame = parseFrame(item);
    if (frame) byStamp.set(frame.stamp, frame);
  }
  return [...byStamp.values()].sort((a, b) => a.timeUTC - b.timeUTC);
}

export function buildSatelliteCloudFramesUrl(): string {
  const url = new URL(FRAME_LIST_URL);
  url.searchParams.set('dataCode', FRAME_DATA_CODE);
  url.searchParams.set('hourRange', '24');
  return url.toString();
}

export async function listSatelliteCloudFrames(
  signal: AbortSignal,
  options: FrameListOptions = {},
): Promise<CloudFrame[]> {
  throwIfAborted(signal);
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? FRAME_CACHE_MS;
  if (!options.fetchImpl && cacheMs > 0 && cachedFrames && cachedFrames.expiresAt > now()) {
    return cachedFrames.frames.map((frame) => ({ ...frame }));
  }

  const metadataSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const response = await (options.fetchImpl ?? fetch)(buildSatelliteCloudFramesUrl(), {
    method: 'GET', signal: metadataSignal, credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`国家卫星气象中心时间列表请求失败 (${response.status})`);
  const frames = parseSatelliteCloudFrames(await response.json());
  throwIfAborted(signal);
  if (frames.length === 0) throw new Error('国家卫星气象中心当前没有可用云图时次');
  if (!options.fetchImpl && cacheMs > 0) {
    cachedFrames = { expiresAt: now() + cacheMs, frames };
  }
  return frames.map((frame) => ({ ...frame }));
}

export function buildSatelliteCloudImageUrl(
  frame: CloudFrame,
  bounds: SatelliteCloudBounds = DEFAULT_BOUNDS,
  size: { width?: number; height?: number } = {},
): string {
  if (!/^\d{12}$/.test(frame.stamp)) throw new Error('卫星云图时次必须是 yyyyMMddHHmm');
  if (!Number.isFinite(frame.timeUTC) || stampForUTC(frame.timeUTC) !== frame.stamp) {
    throw new Error('卫星云图时次与UTC时间不匹配');
  }
  const [west, south, east, north] = bounds;
  if (
    !bounds.every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 ||
    west >= east || south >= north
  ) throw new Error('卫星云图地理范围无效');
  const width = size.width ?? 256;
  const height = size.height ?? 256;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error('卫星云图尺寸无效');
  }

  const url = new URL(WMS_GET_MAP_URL);
  // The NSMC GEOS_IRX example uses 1.1.0 and lon,lat BBOX order. Its
  // 1.3.0 form returned the provider's empty image during the 2026-10 check.
  url.searchParams.set('layers', 'GEOS_IRX');
  url.searchParams.set('datetime', frame.stamp);
  url.searchParams.set('request', 'GetMap');
  url.searchParams.set('bbox', bounds.join(','));
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  url.searchParams.set('version', '1.1.0');
  url.searchParams.set('format', 'png');
  return url.toString();
}

export function cloudPixelsHaveVariation(pixels: Uint8ClampedArray): boolean {
  let first: number | undefined;
  const stride = Math.max(1, Math.floor(pixels.length / 4 / 65_536)) * 4;
  for (let pixel = 0; pixel < pixels.length; pixel += stride) {
    const rgba = ((pixels[pixel] << 24) | (pixels[pixel + 1] << 16) | (pixels[pixel + 2] << 8) | pixels[pixel + 3]) >>> 0;
    if (first !== undefined && rgba !== first) return true;
    first = rgba;
  }
  return false;
}

async function hasSpatialPixelVariation(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('当前设备无法检查卫星云图图像内容');
  }
  const bitmap = await createImageBitmap(blob);
  try {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    } else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    } else {
      throw new Error('当前设备无法检查卫星云图图像内容');
    }
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error('卫星云图像素检查不可用');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    // Some cloud PNGs encode all spatial structure in alpha with white RGB.
    return cloudPixelsHaveVariation(pixels);
  } finally {
    bitmap.close();
  }
}

export async function fetchSatelliteCloudImage(
  frame: CloudFrame,
  _bounds: SatelliteCloudBounds,
  signal: AbortSignal,
  options: CloudImageOptions = {},
): Promise<SatelliteCloudImage> {
  throwIfAborted(signal);
  const key = frame.stamp;
  const useSharedCache = !options.fetchImpl && !options.inspectImage;
  let image = useSharedCache ? completeImages.get(key) : undefined;
  if (image) {
    completeImages.delete(key);
    completeImages.set(key, image);
  } else {
    let pending = useSharedCache ? pendingImages.get(key) : undefined;
    if (!pending) {
      pending = downloadGlobalImage(frame, options);
      if (useSharedCache) pendingImages.set(key, pending);
    }
    try {
      image = await pending;
      if (useSharedCache) {
        pendingImages.delete(key);
        completeImages.set(key, image);
        while (completeImages.size > 2) completeImages.delete(completeImages.keys().next().value!);
      }
    } catch (error) {
      if (useSharedCache) pendingImages.delete(key);
      throw error;
    }
  }
  throwIfAborted(signal);
  return { blob: image.blob, bounds: [...GLOBAL_IMAGE_BOUNDS] };
}

async function downloadGlobalImage(
  frame: CloudFrame,
  options: CloudImageOptions,
): Promise<SatelliteCloudImage> {
  const fetchImage = options.fetchImpl ?? fetchOnlineMapTile;
  const inspect = options.inspectImage ?? hasSpatialPixelVariation;
  let lastError: unknown;
  for (const size of [{ width: 2048, height: 1024 }, { width: 1024, height: 512 }]) {
    try {
      const url = buildSatelliteCloudImageUrl(frame, GLOBAL_IMAGE_BOUNDS, size);
      const response = await fetchImage(url, AbortSignal.timeout(20_000));
      if (!response.ok) throw new Error(`国家卫星气象中心云图请求失败 (${response.status})`);
      const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
        throw new Error('国家卫星气象中心返回的内容不是云图');
      }
      const blob = await response.blob();
      if (blob.size < 128) throw new Error('国家卫星气象中心返回了空白云图');
      if (!await inspect(blob)) throw new Error('国家卫星气象中心返回了空白云图');
      return { blob, bounds: [...GLOBAL_IMAGE_BOUNDS] };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('国家卫星气象中心云图不可用');
}
