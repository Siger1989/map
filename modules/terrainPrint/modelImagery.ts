import type { MapSource } from '../mapSources/types';
import { mercator, type Tile } from '../sky/satelliteTerrainGeometry';
import { loadJourneyImageryTile } from '../sky/satelliteTerrainTiles';
import type { PrintSelection } from './selection';

type Selection = { bounds: PrintSelection['bounds']; shape?: 'rectangle' | 'circle' };

const TILE_SIZE = 256;
const MAX_TEXTURE_EDGE = 1024;
const MAX_MODEL_TILES = 36;
const MAX_MOSAIC_EDGE_TILES = 8;
const CONCURRENT_TILES = 4;
const RAD = Math.PI / 180;

export function canUseTerrainModelImagery(source: MapSource): boolean {
  return source.kind === 'online' &&
    !/\b(mvt|pbf|vector)\b/i.test(source.format) &&
    Boolean(source.ovmap?.layers[0]?.tiles.length || source.tiles?.length);
}

function footprint(selection: Selection) {
  const { west, south, east, north } = selection.bounds;
  if (![west, south, east, north].every(Number.isFinite) ||
      west < -180 || east > 180 || south < -85 || north > 85 ||
      east <= west || north <= south) {
    throw new Error('此模型的地图范围无效。');
  }
  const latitude = ((north + south) / 2) * RAD;
  // Match the tangent-plane aspect ratio used when generating the terrain mesh.
  const eccentricitySquared = 0.00669437999014;
  const longitudeRatio = Math.cos(latitude) *
    (1 - eccentricitySquared * Math.sin(latitude) ** 2) / (1 - eccentricitySquared);
  const aspect = (east - west) * longitudeRatio / (north - south);
  if (selection.shape === 'circle') {
    const centerLng = (east + west) / 2;
    const centerLat = (north + south) / 2;
    const halfWidth = ((east - west) / 2) * Math.min(1, 1 / aspect);
    const halfHeight = ((north - south) / 2) * Math.min(1, aspect);
    return { west: centerLng - halfWidth, east: centerLng + halfWidth,
      north: centerLat + halfHeight, south: centerLat - halfHeight, aspect: 1 };
  }
  return { west, north, east, south, aspect };
}

function tileWindow(bounds: PrintSelection['bounds'], z: number) {
  const [left, top] = mercator(bounds.west, bounds.north, z);
  const [wrappedRight, bottom] = mercator(bounds.east, bounds.south, z);
  const right = bounds.east === 180 ? 2 ** z : wrappedRight;
  const x = Math.floor(left), y = Math.floor(top);
  const columns = Math.ceil(right) - x, rows = Math.ceil(bottom) - y;
  return { z, x, y, columns, rows, left, top, right, bottom };
}

function createSurface(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建模型贴图画布。');
  return { canvas, context };
}

/** Build one north-up WGS84 texture from the application's exact raster tile transport. */
export async function terrainModelImagery(selection: Selection, source: MapSource, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!canUseTerrainModelImagery(source)) throw new Error('该图源没有受支持的在线栅格影像。');
  const bounds = footprint(selection);
  if (source.bounds) {
    const [west, south, east, north] = source.bounds;
    const coversLongitude = west <= east
      ? west <= bounds.west && east >= bounds.east
      : bounds.west >= west || bounds.east <= east;
    if (!coversLongitude || south > bounds.south || north < bounds.north) {
      throw new Error('选中的图源未覆盖整个模型范围。');
    }
  }
  const topLayer = source.ovmap?.layers[0];
  const minZoom = Math.ceil(Math.max(0, source.minzoom, topLayer?.minzoom ?? 0));
  const maxZoom = Math.floor(Math.min(24, source.maxzoom, topLayer?.maxzoom ?? 24));
  let plan = tileWindow(bounds, maxZoom);
  const fitsBudget = (tile: typeof plan) => tile.rows * tile.columns <= MAX_MODEL_TILES &&
    Math.max(tile.rows, tile.columns) <= MAX_MOSAIC_EDGE_TILES;
  while (plan.z > minZoom && (!fitsBudget(plan) ||
      Math.max(plan.right - plan.left, plan.bottom - plan.top) * TILE_SIZE > 2 * MAX_TEXTURE_EDGE)) {
    plan = tileWindow(bounds, plan.z - 1);
  }
  const count = plan.columns * plan.rows;
  if (minZoom > maxZoom || !Number.isSafeInteger(count) || count < 1 || !fitsBudget(plan)) {
    throw new Error('该图源在此模型范围内没有可读取的影像级别。');
  }
  const mosaic = createSurface(plan.columns * TILE_SIZE, plan.rows * TILE_SIZE);
  const requests = new AbortController();
  const loadSignal = AbortSignal.any([signal, requests.signal]);
  let nextTile = 0;
  const workers = Array.from({ length: Math.min(count, CONCURRENT_TILES) }, async () => {
    while (nextTile < count) {
      loadSignal.throwIfAborted();
      const index = nextTile++;
      const column = index % plan.columns, row = Math.floor(index / plan.columns);
      const x = plan.x + column, y = plan.y + row;
      const tile: Tile = { z: plan.z, x, y, key: `${plan.z}/${x}/${y}` };
      const image = await loadJourneyImageryTile(source, tile, loadSignal);
      if (!image) throw new Error('选区有影像瓦片缺失或图源暂不可用，请更换图源或重试。');
      try {
        loadSignal.throwIfAborted();
        mosaic.context.drawImage(image, column * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } finally {
        image.close();
      }
    }
  });
  try {
    await Promise.all(workers);
  } catch (error) {
    requests.abort();
    signal.throwIfAborted();
    if (error instanceof Error && error.message.startsWith('选区有影像瓦片缺失')) throw error;
    throw new Error('图源读取失败，请检查网络后重试。');
  }

  const sourceWidth = (plan.right - plan.left) * TILE_SIZE;
  const sourceHeight = (plan.bottom - plan.top) * TILE_SIZE;
  const longerEdge = Math.max(1, Math.min(MAX_TEXTURE_EDGE, Math.ceil(Math.max(sourceWidth, sourceHeight))));
  const width = Math.max(1, Math.round(longerEdge * Math.min(1, bounds.aspect)));
  const height = Math.max(1, Math.round(longerEdge * Math.min(1, 1 / bounds.aspect)));
  const output = createSurface(width, height);
  const x = (plan.left - plan.x) * TILE_SIZE;
  // A latitudinal row in the DEM has uniform geographic spacing, unlike the source tile rows.
  // Resample seams together from one mosaic so preview and exported UV use the same pixels.
  let previousY = (plan.top - plan.y) * TILE_SIZE;
  for (let row = 0; row < height; row++) {
    const latitude = bounds.north + (bounds.south - bounds.north) * (row + 1) / height;
    const [, mercatorY] = mercator(bounds.west, latitude, plan.z);
    const y = (mercatorY - plan.y) * TILE_SIZE;
    output.context.drawImage(mosaic.canvas, x, previousY, sourceWidth, y - previousY, 0, row, width, 1);
    previousY = y;
  }
  signal.throwIfAborted();
  const png = await new Promise<Blob>((resolve, reject) => {
    output.canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法编码模型 PNG 贴图。')), 'image/png');
  });
  signal.throwIfAborted();
  return png;
}
