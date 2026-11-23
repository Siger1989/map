import { warpPlan, pixelLngLat, type RasterDatum } from '../mapSources/coordinates';
import { isKnownNoImageryBytes, isNoImageryResponse } from '../mapSources/noImageryTile';
import { renderOvmapTileAddress } from '../mapSources/ovmapTemplates';
import { rasterTileUrl } from '../mapSources/RasterCoordinates';
import { resampleRasterPixels } from '../mapSources/rasterResampler';
import { defaultRasterDatum } from '../mapSources/sourceDatum';
import type { MapSource, OvmapTileLayer } from '../mapSources/types';
import type { Tile } from './satelliteTerrainGeometry';

const size = 256;
const overlayBudgetMs = 900;
type RasterFetcher = (url: string, signal: AbortSignal) => Promise<Response>;
type RequestLayer = OvmapTileLayer & { ovmap: boolean };
type RasterTile = { bitmap: ImageBitmap; blob: Blob };

function coveredBySource(source: MapSource, { z, x, y }: Tile) {
  if (!source.bounds) return true;
  const [west, south, east, north] = source.bounds;
  const [left, top] = pixelLngLat(x, y, 2 ** z);
  const [right, bottom] = pixelLngLat(x + 1, y + 1, 2 ** z);
  return north > bottom && south < top && (west <= east ? west < right && east > left : west < right || east > left);
}

function canvas(width = size, height = size) {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const context = surface.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法初始化行程底图');
  return { surface, context };
}

async function decode(blob: Blob, signal: AbortSignal): Promise<RasterTile> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(blob);
  if (signal.aborted) bitmap.close();
  signal.throwIfAborted();
  return { bitmap, blob };
}

function encode(surface: HTMLCanvasElement, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<Blob>((resolve, reject) => {
    surface.toBlob(blob => blob ? resolve(blob) : reject(new Error('行程底图影像编码失败')), 'image/png');
  }).then(blob => decode(blob, signal));
}

function layerInRange(layer: RequestLayer, z: number) {
  return z >= layer.minzoom && z <= layer.maxzoom && layer.tiles.length > 0;
}

async function readLayer(layer: RequestLayer, z: number, x: number, y: number, scheme: 'xyz' | 'tms',
  fetchTile: RasterFetcher, signal: AbortSignal) {
  const n = 2 ** z;
  x = ((x % n) + n) % n;
  y = Math.max(0, Math.min(n - 1, y));
  const url = layer.ovmap
    ? renderOvmapTileAddress(layer.tiles[(x + y) % layer.tiles.length], z, x, y, scheme)
    : rasterTileUrl(layer.tiles, z, x, y, scheme);
  const response = await fetchTile(url, signal);
  if (!response.ok || isNoImageryResponse(response)) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  if (await isKnownNoImageryBytes(bytes)) return null;
  const raster = await decode(new Blob([bytes]), signal);
  const width = raster.bitmap.width;
  if (width !== raster.bitmap.height || (layer.subdivide && width !== layer.tileSize)) {
    raster.bitmap.close();
    return null;
  }
  return raster;
}

function drawLayer(context: CanvasRenderingContext2D, raster: RasterTile, layer: RequestLayer,
  x: number, y: number, left = 0, top = 0) {
  const pixels = raster.bitmap.width / (layer.subdivide ? 2 : 1);
  const startX = layer.subdivide ? (((x % 2) + 2) % 2) * pixels : 0;
  const startY = layer.subdivide ? (((y % 2) + 2) % 2) * pixels : 0;
  context.drawImage(raster.bitmap, startX, startY, pixels, pixels, left, top, size, size);
}

async function drawOverlays(context: CanvasRenderingContext2D, overlays: RequestLayer[], { z, x, y }: Pick<Tile, 'z' | 'x' | 'y'>,
  scheme: 'xyz' | 'tms', fetchTile: RasterFetcher, signal: AbortSignal, left = 0, top = 0) {
  if (!overlays.length) return;
  const overlaySignal = AbortSignal.any([signal, AbortSignal.timeout(overlayBudgetMs)]);
  for (const layer of overlays) {
    if (overlaySignal.aborted) break;
    const raster = await readLayer(layer, z, x, y, scheme, fetchTile, overlaySignal).catch(() => null);
    if (!raster) continue;
    try { drawLayer(context, raster, layer, x, y, left, top); }
    finally { raster.bitmap.close(); }
  }
}

async function readExactTile(base: RequestLayer, overlays: RequestLayer[], source: MapSource, { z, x, y }: Tile,
  fetchTile: RasterFetcher, signal: AbortSignal) {
  const scheme = source.scheme ?? 'xyz';
  const raster = await readLayer(base, z, x, y, scheme, fetchTile, signal);
  if (!raster) return null;
  if (!overlays.length && !base.subdivide && raster.bitmap.width === size) return raster;
  try {
    const output = canvas();
    drawLayer(output.context, raster, base, x, y);
    await drawOverlays(output.context, overlays, { z, x, y }, scheme, fetchTile, signal);
    return await encode(output.surface, signal);
  } finally { raster.bitmap.close(); }
}

async function readWarpedTile(base: RequestLayer, overlays: RequestLayer[], scheme: 'xyz' | 'tms', datum: RasterDatum, tile: Tile,
  fetchTile: RasterFetcher, signal: AbortSignal) {
  const plan = warpPlan(tile.z, tile.x, tile.y, size, datum);
  const mosaic = canvas(plan.width * size, plan.height * size);
  const world = 2 ** tile.z;
  const requests = Array.from({ length: plan.width * plan.height }, async (_, index) => {
    const column = index % plan.width, row = Math.floor(index / plan.width);
    const x = plan.left + column, y = Math.max(0, Math.min(world - 1, plan.top + row));
    const input = await readLayer(base, tile.z, x, y, scheme, fetchTile, signal);
    if (!input) return false;
    const left = column * size, top = row * size;
    try { drawLayer(mosaic.context, input, base, x, y, left, top); }
    finally { input.bitmap.close(); }
    await drawOverlays(mosaic.context, overlays, { ...tile, x, y }, scheme, fetchTile, signal, left, top);
    return true;
  });
  if (!(await Promise.all(requests)).every(Boolean)) return null;
  signal.throwIfAborted();
  const input = mosaic.context.getImageData(0, 0, mosaic.surface.width, mosaic.surface.height);
  const output = canvas();
  const imageData = output.context.createImageData(size, size);
  resampleRasterPixels(plan, input.data, imageData.data);
  output.context.putImageData(imageData, 0, 0);
  return encode(output.surface, signal);
}

/** Read exact geographic imagery. The terrain renderer chooses if and when a parent is displayed. */
export async function loadExactJourneyRaster(source: MapSource, tile: Tile, fetchTile: RasterFetcher,
  signal: AbortSignal, remember?: (image: Blob) => void): Promise<ImageBitmap | null> {
  if (source.kind !== 'online' || tile.z < source.minzoom || tile.z > source.maxzoom || !coveredBySource(source, tile)) return null;
  const [base, ...overlays] = source.ovmap?.layers.length
    ? source.ovmap.layers.map(layer => ({ ...layer, ovmap: true }))
    : [{ ...source, tiles: source.tiles ?? [], ovmap: false }];
  if (!layerInRange(base, tile.z)) return null;
  const activeOverlays = overlays.filter(layer => layerInRange(layer, tile.z));
  const datum = source.datum ?? defaultRasterDatum(source);
  const raster = datum === 'wgs84'
    ? await readExactTile(base, activeOverlays, source, tile, fetchTile, signal)
    : await readWarpedTile(base, activeOverlays, source.scheme ?? 'xyz', datum, tile, fetchTile, signal);
  if (!raster) return null;
  remember?.(raster.blob);
  return raster.bitmap;
}
