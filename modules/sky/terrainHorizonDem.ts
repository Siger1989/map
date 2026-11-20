import type { JourneySample, ElevationSample } from '../journey/metrics';
import { cachedMapFetch, offlineMapOnly } from '../outdoor/tileCache';
import { decodeTerrain } from '../section/terrainMath';
import { TERRAIN_URL, terrainRenderUrl } from '../terrain/tiles';

const TILE_SIZE = 256;
const TILE_TIMEOUT_MS = 12_000;
const PROFILE_TIMEOUT_MS = 30_000;
const cache = new Map<string, Float32Array>();

export { offlineMapOnly };

function samplePixel({ coordinates: [lng, lat], distance }: JourneySample) {
  const latitude = lat * Math.PI / 180;
  // Farther ridges permit coarser tiles, keeping the tile count bounded at high latitudes.
  const zoom = Math.max(5, Math.min(12, Math.floor(
    Math.log2(40_030_228 * Math.cos(latitude) / Math.max(1, distance * 0.8)),
  )));
  const tiles = 2 ** zoom;
  const x = ((lng + 180) / 360) * tiles;
  const y = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) * tiles / 2;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const index = Math.floor((y - tileY) * TILE_SIZE) * TILE_SIZE + Math.floor((x - tileX) * TILE_SIZE);
  return { tileX, tileY, zoom, index };
}

async function readTile(key: string, zoom: number, x: number, y: number, signal: AbortSignal) {
  const offline = offlineMapOnly();
  const cached = offline ? undefined : cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const expand = (url: string) => url.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
  const origin = window.location.origin;
  const url = expand(origin + TERRAIN_URL);
  const response = await cachedMapFetch(
    url,
    AbortSignal.any([signal, AbortSignal.timeout(TILE_TIMEOUT_MS)]),
    undefined,
    false,
    (_, requestSignal) => fetch(expand(terrainRenderUrl(origin)), { signal: requestSignal }),
  );
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    signal.throwIfAborted();
    if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const data = decodeTerrain(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
    if (!offline) {
      if (cache.size >= 40) cache.delete(cache.keys().next().value!);
      cache.set(key, data);
    }
    return data;
  } finally {
    bitmap.close();
  }
}

export async function readHorizonProfile(samples: JourneySample[], signal: AbortSignal): Promise<ElevationSample[]> {
  const groups = new Map<string, { x: number; y: number; zoom: number; entries: { point: number; pixel: number }[] }>();
  samples.forEach((sample, point) => {
    const { tileX, tileY, zoom, index } = samplePixel(sample);
    const key = [zoom, tileX, tileY].join('/');
    let group = groups.get(key);
    if (!group) {
      group = { x: tileX, y: tileY, zoom, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ point, pixel: index });
  });
  const result: ElevationSample[] = samples.map(sample => ({ ...sample, elevation: null }));
  const queue = groups.entries();
  const budget = AbortSignal.any([signal, AbortSignal.timeout(PROFILE_TIMEOUT_MS)]);
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (const [key, { x, y, zoom, entries }] of queue) {
      if (budget.aborted) break;
      try {
        const heights = await readTile(key, zoom, x, y, budget);
        if (!heights) continue;
        for (const { point, pixel } of entries) {
          const metres = heights[pixel];
          if (Number.isFinite(metres)) result[point].elevation = metres;
        }
      } catch {
        signal.throwIfAborted();
      }
    }
  }));
  signal.throwIfAborted();
  return result;
}
