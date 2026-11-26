import type { PrintSelection } from './selection';
import type { TerrainPrintGrid } from './mesh';
import type { Tile } from '../sky/satelliteTerrainGeometry';
import { selectionGroundSize } from './groundSize.ts';

const TILE_SIZE = 256;
const MAX_ZOOM = 12; // The map's built-in Terrarium source upper zoom.
const MAX_SAMPLES = 240_000;
const MAX_GRID_SIDE = 1600;
const radians = Math.PI / 180;

type ReadTile = (tile: Tile, signal: AbortSignal) => Promise<Float32Array | null>;

async function readMapDemTile(tile: Tile, signal: AbortSignal) {
  const { loadSatelliteDem } = await import('../sky/satelliteTerrainTiles');
  return loadSatelliteDem(tile, signal);
}

/** Sample the same north-up Terrarium pixels that drive the map, including neighbours across tile seams. */
export async function loadBuiltinTerrainPrintDem(
  selection: PrintSelection, signal: AbortSignal, readTile: ReadTile = readMapDemTile,
): Promise<TerrainPrintGrid> {
  signal.throwIfAborted();
  const { west, east, north, south } = selection.bounds;
  if (![west, east, south, north].every(Number.isFinite) ||
      west < -180 || east > 180 || west >= east || south < -85 || north > 85 || south >= north) {
    throw new Error('请重新选择有效的地图范围。');
  }
  const { width: eastWestMeters, height: northSouthMeters } = selectionGroundSize(selection);
  if (Math.max(eastWestMeters, northSouthMeters) > 64_000) {
    throw new Error('单边最大支持 64 公里，请缩小选区后再生成。');
  }

  const circumference = 2 * Math.PI * 6378137 * Math.cos((north + south) / 2 * radians);
  const target = Math.max(eastWestMeters / (MAX_GRID_SIDE - 1), northSouthMeters / (MAX_GRID_SIDE - 1),
    Math.sqrt(eastWestMeters * northSouthMeters / MAX_SAMPLES));
  const z = Math.max(0, Math.min(MAX_ZOOM, Math.ceil(Math.log2(circumference / (TILE_SIZE * target)))));
  const side = 2 ** z, world = TILE_SIZE * side;
  const sourceSpacing = circumference / world;
  let spacing = Math.max(sourceSpacing, target);
  let width: number, height: number;
  do {
    width = Math.max(3, Math.ceil(eastWestMeters / spacing) + 1);
    height = Math.max(3, Math.ceil(northSouthMeters / spacing) + 1);
    if (width * height <= MAX_SAMPLES && Math.max(width, height) <= MAX_GRID_SIDE) break;
    spacing = Math.max(spacing + 1, spacing * Math.sqrt(width * height / MAX_SAMPLES));
  } while (true);

  const xs = Float64Array.from({ length: width }, (_, i) => ((west + (east - west) * i / (width - 1) + 180) / 360) * world - 0.5);
  const ys = Float64Array.from({ length: height }, (_, i) => {
    const latitude = (north - (north - south) * i / (height - 1)) * radians;
    return (1 - Math.asinh(Math.tan(latitude)) / Math.PI) * world / 2 - 0.5;
  });
  const wrap = (x: number) => (x % side + side) % side;
  const tiles = new Map<number, Tile>();
  for (let y = Math.floor(ys[0] / TILE_SIZE); y <= Math.floor((ys[height - 1] + 1) / TILE_SIZE); y++) {
    for (let x = Math.floor(xs[0] / TILE_SIZE); x <= Math.floor((xs[width - 1] + 1) / TILE_SIZE); x++) {
      const col = wrap(x);
      tiles.set(y * side + col, { x: col, y, z, key: [z, col, y].join('/') });
    }
  }
  const pixels = new Map<number, Float32Array>();
  const jobs = tiles.entries();
  const stop = new AbortController();
  const readSignal = AbortSignal.any([signal, stop.signal, AbortSignal.timeout(90_000)]);
  try {
    await Promise.all(Array.from({ length: Math.min(4, tiles.size) }, async () => {
      for (const [key, tile] of jobs) {
        readSignal.throwIfAborted();
        const data = await readTile(tile, readSignal);
        if (data?.length === TILE_SIZE * TILE_SIZE) pixels.set(key, data);
      }
    }));
  } catch {
    signal.throwIfAborted();
    throw new Error('地图地形瓦片读取失败，请检查网络或离线地图覆盖。');
  } finally {
    stop.abort();
  }

  function elevation(x: number, y: number) {
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    return pixels.get(ty * side + wrap(tx))?.[(y - ty * TILE_SIZE) * TILE_SIZE + x - tx * TILE_SIZE];
  }
  const elevations: TerrainPrintGrid['elevations'] = [];
  for (const y of ys) {
    const top = Math.floor(y), fy = y - top;
    for (const x of xs) {
      const left = Math.floor(x), fx = x - left;
      let metres = 0;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          if (weight > 0) metres += weight * (elevation(left + dx, top + dy) ?? NaN);
        }
      }
      elevations.push(Number.isFinite(metres) ? metres : null);
    }
  }
  if (elevations.every(value => value === null)) throw new Error('选区没有可读取的地图高程，请检查网络或离线地图覆盖。');
  return {
    width, height, eastWestMeters, northSouthMeters, elevations,
    sampleSpacingMeters: Math.max(sourceSpacing, eastWestMeters / (width - 1), northSouthMeters / (height - 1)),
  };
}
