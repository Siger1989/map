import { BaseClient, BaseResponse, fromCustomClient, type GeoTIFF } from 'geotiff';
import proj4 from 'proj4';

export type TerrainPrintBounds = { west: number; south: number; east: number; north: number };

const NASA_CATALOG_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json';
const NASA_FILES_ORIGIN = 'https://data.nsidc.earthdatacloud.nasa.gov';
const HMA_MOSAIC_COLLECTION = 'C3249536691-NSIDC_CPRD';
const TILE_PATH = /^\/nsidc-cumulus-prod-protected\/HMA\/HMA_DEM8m_MOS\/1\/\d{4}\/\d{2}\/\d{2}\/(HMA_DEM8m_MOS_\d{8}_tile-\d{3}\.tif)$/;
const HMA_ALBERS = '+proj=aea +lat_1=25 +lat_2=47 +lat_0=36 +lon_0=85 +x_0=0 +y_0=0 +datum=WGS84 +units=m';
const SAMPLE_METERS = 8;
const MAX_SAMPLES = 240_000;
const MAX_TILES = 8;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;

type FailureCode = 'INVALID_SELECTION' | 'AREA_TOO_LARGE' | 'NO_COVERAGE' | 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'DEM_UNAVAILABLE';

export class TerrainPrintDemError extends Error {
  readonly code: FailureCode;
  readonly status: number;

  constructor(code: FailureCode, status: number, message: string) {
    super(message);
    this.name = 'TerrainPrintDemError';
    this.code = code;
    this.status = status;
  }
}

type RasterGrid = {
  width: number;
  height: number;
  eastWestMeters: number;
  northSouthMeters: number;
  elevations: (number | null)[];
};

export type TerrainPrintDemOptions = {
  token?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  cachedTile?: (filename: string, signal: AbortSignal) => Promise<GeoTIFF | null>;
};

function parseSelection(input: unknown) {
  const request = input as { bounds?: Partial<TerrainPrintBounds>; shape?: unknown; token?: unknown } | null;
  const { west, south, east, north } = request?.bounds ?? {};
  const shape = request?.shape;
  if (
    (shape !== 'rectangle' && shape !== 'circle') ||
    typeof west !== 'number' || typeof south !== 'number' || typeof east !== 'number' || typeof north !== 'number' ||
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 || east > 180 || south < -85 || north > 85 || west >= east || south >= north
  ) throw new TerrainPrintDemError('INVALID_SELECTION', 422, '请在地图上重新框选一个有效范围。');
  const token = request?.token;
  if (token !== undefined && (typeof token !== 'string' || token.length > 4096 || /\s/.test(token.trim()))) {
    throw new TerrainPrintDemError('AUTH_INVALID', 401, 'Earthdata 令牌格式有误，请重新复制。');
  }
  return { bounds: { west, south, east, north }, token: token?.trim() };
}

function printDimensions(bounds: TerrainPrintBounds) {
  const toRadians = Math.PI / 180;
  const latitude = (bounds.south + bounds.north) / 2 * toRadians;
  const wgs84A = 6_378_137;
  const wgs84EccentricitySquared = 0.00669437999014;
  const t = Math.sqrt(1 - wgs84EccentricitySquared * Math.sin(latitude) ** 2);
  const eastWestMeters = (bounds.east - bounds.west) * toRadians * wgs84A * Math.cos(latitude) / t;
  const northSouthMeters = (bounds.north - bounds.south) * toRadians * wgs84A * (1 - wgs84EccentricitySquared) / t ** 3;
  const width = Math.max(3, Math.ceil(eastWestMeters / SAMPLE_METERS) + 1);
  const height = Math.max(3, Math.ceil(northSouthMeters / SAMPLE_METERS) + 1);
  if (width * height > MAX_SAMPLES || Math.max(width, height) > 1600) {
    throw new TerrainPrintDemError('AREA_TOO_LARGE', 422, '该范围的 8 米模型过大，请缩小选区。正方形建议不超过约 3.8 公里边长。');
  }
  return { width, height, eastWestMeters, northSouthMeters };
}

function unavailable(message = 'NASA 8 米高程服务暂不可用，请稍后重试。') {
  return new TerrainPrintDemError('DEM_UNAVAILABLE', 502, message);
}

function noCoverage(message = '此选区没有 NASA 高山亚洲 8 米 DEM 覆盖。') {
  return new TerrainPrintDemError('NO_COVERAGE', 404, message);
}

function authInvalid() {
  return new TerrainPrintDemError('AUTH_INVALID', 401, 'NASA 未接受 Earthdata 令牌，请确认令牌有效且账户已授权 NSIDC 高程下载。');
}

async function findTiles(bounds: TerrainPrintBounds, fetcher: typeof fetch, signal: AbortSignal) {
  const url = new URL(NASA_CATALOG_URL);
  url.searchParams.set('collection_concept_id', HMA_MOSAIC_COLLECTION);
  url.searchParams.set('bounding_box', [bounds.west, bounds.south, bounds.east, bounds.north].join(','));
  url.searchParams.set('page_size', String(MAX_TILES + 1));
  const response = await fetcher(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    redirect: 'error',
  });
  if (!response.ok) throw unavailable();
  const catalog = await response.json() as { feed?: { entry?: { links?: { href?: unknown }[] }[] } };
  const entries = catalog.feed?.entry;
  if (!Array.isArray(entries)) throw unavailable();
  if (entries.length === 0) throw noCoverage();
  if (entries.length > MAX_TILES) throw unavailable('NASA 目录返回了过多瓦片，请缩小选区后再试。');
  const tiles = new Map<string, string>();
  for (const entry of entries) {
    for (const link of Array.isArray(entry.links) ? entry.links : []) {
      if (typeof link.href !== 'string' || !link.href.startsWith(NASA_FILES_ORIGIN + '/')) continue;
      const url = new URL(link.href);
      const filename = TILE_PATH.exec(url.pathname)?.[1];
      if (filename && !url.search && !url.hash) tiles.set(filename, url.href);
    }
  }
  if (tiles.size === 0) throw unavailable('NASA 目录缺少可读取的 8 米高程文件。');
  return tiles;
}

class ByteRangeResponse extends BaseResponse {
  private readonly response: Response;

  constructor(response: Response) {
    super();
    this.response = response;
  }

  get status() { return this.response.status; }
  getHeader(name: string) { return this.response.headers.get(name) ?? undefined; }
  getData() { return this.response.arrayBuffer(); }
}

class AuthenticatedTile extends BaseClient {
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly signal: AbortSignal;

  constructor(url: string, token: string, fetcher: typeof fetch, signal: AbortSignal) {
    super(url);
    this.token = token;
    this.fetcher = fetcher;
    this.signal = signal;
  }

  async request(options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('Range') ?? '');
    if (!range || Number(range[2]) - Number(range[1]) + 1 > MAX_RANGE_BYTES) throw unavailable();
    headers.set('Authorization', 'Bearer ' + this.token);
    const response = await this.fetcher(this.url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.any(options.signal ? [this.signal, options.signal] : [this.signal]),
    });
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status) || response.type === 'opaqueredirect') {
      await response.body?.cancel();
      throw authInvalid();
    }
    const contentRange = /^bytes (\d+)-(\d+)\/\d+$/.exec(response.headers.get('Content-Range') ?? '');
    if (
      response.status !== 206 || !contentRange ||
      Number(contentRange[1]) !== Number(range[1]) || Number(contentRange[2]) > Number(range[2])
    ) {
      await response.body?.cancel();
      throw unavailable('NASA 高程文件未返回可读取的 GeoTIFF 分块。');
    }
    return new ByteRangeResponse(response);
  }
}

function verifyProjection(keys: ReturnType<Awaited<ReturnType<GeoTIFF['getImage']>>['getGeoKeys']>) {
  if (
    !keys || keys.ProjectedCSTypeGeoKey !== 32767 || keys.GeographicTypeGeoKey !== 4326 ||
    keys.ProjCoordTransGeoKey !== 11 || keys.ProjLinearUnitsGeoKey !== 9001 ||
    keys.ProjNatOriginLatGeoKey !== 36 || keys.ProjNatOriginLongGeoKey !== 85 ||
    keys.ProjStdParallel1GeoKey !== 25 || keys.ProjStdParallel2GeoKey !== 47 ||
    keys.ProjFalseEastingGeoKey !== 0 || keys.ProjFalseNorthingGeoKey !== 0
  ) throw unavailable('NASA 高程文件的坐标参考与 HMA 8 米产品不符。');
}

async function addTileSamples(
  tiff: GeoTIFF, grid: RasterGrid, projectedX: Float64Array, projectedY: Float64Array, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const image = await tiff.getImage();
  verifyProjection(image.getGeoKeys());
  const [originX, originY] = image.getOrigin();
  const [pixelWidth, pixelHeight] = image.getResolution();
  if (pixelWidth !== SAMPLE_METERS || pixelHeight !== -SAMPLE_METERS || image.getSamplesPerPixel() !== 1) {
    throw unavailable('NASA 高程文件的像元并非预期的 8 米。');
  }
  const imageWidth = image.getWidth();
  const imageHeight = image.getHeight();
  let left = imageWidth, top = imageHeight, right = 0, bottom = 0;
  const pixelXs = new Int32Array(grid.elevations.length).fill(-1);
  const pixelYs = new Int32Array(grid.elevations.length);
  for (let i = 0; i < grid.elevations.length; i++) {
    if (grid.elevations[i] !== null) continue;
    const x = Math.floor((projectedX[i] - originX) / pixelWidth);
    const y = Math.floor((projectedY[i] - originY) / pixelHeight);
    if (x < 0 || x >= imageWidth || y < 0 || y >= imageHeight) continue;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
    pixelXs[i] = x;
    pixelYs[i] = y;
  }
  if (right <= left || bottom <= top) return;
  const samples = await image.readRasters({ window: [left, top, right, bottom], interleave: true, samples: [0], signal });
  const noData = image.getGDALNoData();
  for (let i = 0; i < grid.elevations.length; i++) {
    const x = pixelXs[i];
    if (x < 0) continue;
    const v = samples[(pixelYs[i] - top) * (right - left) + x - left];
    if (v !== noData && Number.isFinite(v)) grid.elevations[i] = v;
  }
}

/** Reads only the TIFF chunks intersecting the requested, north-first output grid. */
export async function getTerrainPrintDem(input: unknown, options: TerrainPrintDemOptions = {}): Promise<RasterGrid> {
  const { bounds, token: requestToken } = parseSelection(input);
  const dimensions = printDimensions(bounds);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(110_000)]);
  const fetcher = options.fetch ?? fetch;
  const token = requestToken || options.token;
  try {
    const tiles = await findTiles(bounds, fetcher, signal);
    const grid: RasterGrid = { ...dimensions, elevations: Array(dimensions.width * dimensions.height).fill(null) };
    const convert = proj4('EPSG:4326', HMA_ALBERS);
    const projectedX = new Float64Array(grid.elevations.length);
    const projectedY = new Float64Array(grid.elevations.length);
    for (let y = 0; y < grid.height; y++) {
      const latitude = bounds.north - (bounds.north - bounds.south) * y / (grid.height - 1);
      for (let x = 0; x < grid.width; x++) {
        const longitude = bounds.west + (bounds.east - bounds.west) * x / (grid.width - 1);
        const i = y * grid.width + x;
        [projectedX[i], projectedY[i]] = convert.forward([longitude, latitude]);
        if (!Number.isFinite(projectedX[i]) || !Number.isFinite(projectedY[i])) {
          throw unavailable('无法将所选范围转换为 NASA 高程坐标。');
        }
      }
    }
    for (const [filename, url] of tiles) {
      if (grid.elevations.every((value) => value !== null)) break;
      let tiff = await options.cachedTile?.(filename, signal);
      if (!tiff) {
        if (!token) throw new TerrainPrintDemError('AUTH_REQUIRED', 401, '自动下载 8 米 DEM 需要有效的 NASA Earthdata 令牌。');
        tiff = await fromCustomClient(new AuthenticatedTile(url, token, fetcher, signal), { maxRanges: 0 }, signal);
      }
      try {
        await addTileSamples(tiff, grid, projectedX, projectedY, signal);
      } finally {
        await tiff.close();
      }
    }
    if (grid.elevations.every((value) => value === null)) {
      throw noCoverage('此选区在 NASA 8 米 DEM 中全部是空值，请移动或缩小选区。');
    }
    return grid;
  } catch (error) {
    if (error instanceof TerrainPrintDemError) throw error;
    throw unavailable();
  }
}
