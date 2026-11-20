import { basemapConfiguration, tiandituTiles } from '../cartography/basemaps';
import { isKnownNoImageryBytes } from '../mapSources/noImageryTile';
import { fetchTiandituResponse } from '../mapSources/tiandituProtocol';
import { createBrowserTileCache } from '../mapSources/browserTileCache';
import { cachedMapFetch } from '../outdoor/tileCache';
import { decodeTerrain } from '../section/terrainMath';
import { TERRAIN_URL, terrainRenderUrl } from '../terrain/tiles';
import type { Tile } from './satelliteTerrainGeometry';

const tileSize = 256;
let terrainStore: ReturnType<typeof createBrowserTileCache> | undefined;

// Compressed source bytes survive seeking, GPU eviction, and reopening a journey.
// Read this cache inside cachedMapFetch's online branch to respect selected offline packages.
function store() {
  return terrainStore ??= createBrowserTileCache({
    databaseName:'shantu-sky-terrain-v1', ttlMs:24*60*60*1000,
    maxBytes:72*1024*1024, maxEntries:2048, memoryMaxBytes:8*1024*1024, readTimeoutMs:120,
  });
}

function expand(template: string, { z, x, y }: Tile) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

type NativeTileBridge = { cancelMapTile?: (requestId: string) => void };

async function fetchAndroidImagery(request: string, requestSignal: AbortSignal) {
    const requestId = 'mt-sky-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), id => id.toString(16)).join('-');
    const bridge = (globalThis as typeof globalThis & { GuanyunNative?: NativeTileBridge }).GuanyunNative;
    const cancel = () => bridge?.cancelMapTile?.(requestId);
    requestSignal.throwIfAborted();
    requestSignal.addEventListener('abort', cancel, { once: true });
    const endpoint = new URL('/api/map-tile', location.origin);
    endpoint.searchParams.set('url', request);
    endpoint.searchParams.set('requestId', requestId);
    try {
      const response = await fetch(endpoint, { signal: requestSignal, referrerPolicy: 'no-referrer' });
      // Keep native cancellation wired through completion of the response body.
      if (!response.ok) return response;
      return new Response(await response.arrayBuffer(), { headers: { 'Content-Type': 'application/octet-stream' } });
    } finally {
      requestSignal.removeEventListener('abort', cancel);
    }
}

export function satelliteImageryAvailable() {
  return basemapConfiguration().domestic;
}

export async function loadSatelliteTile(tile: Tile, signal: AbortSignal) {
  const { token } = basemapConfiguration();
  const template = tiandituTiles('img', token)[0];
  const url = expand(template, tile);
  const key = 'tdt-img/' + tile.key;
  let fetched = false;
  const response = location.hostname === 'appassets.androidplatform.net'
    ? await cachedMapFetch(url,signal,undefined,true,async (request,requestSignal) => {
      const hit = await store().get(key);
      requestSignal.throwIfAborted();
      if (hit) return new Response(hit);
      fetched = true;
      return fetchAndroidImagery(request, requestSignal);
    })
    : await fetchTiandituResponse(url, signal);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (await isKnownNoImageryBytes(bytes)) return null;
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(new Blob([bytes]));
  if (signal.aborted || bitmap.width !== tileSize || bitmap.height !== tileSize) {
    bitmap.close();
    signal.throwIfAborted();
    return null;
  }
  if (fetched) store().put(key,bytes);
  return bitmap;
}

export async function loadSatelliteDem(tile: Tile, signal: AbortSignal) {
  const origin = location.origin;
  const key = expand(TERRAIN_URL,tile);
  let fetched = false;
  const response = await cachedMapFetch(origin + key, signal, undefined, false, async (_, requestSignal) => {
    const hit = await store().get(key);
    requestSignal.throwIfAborted();
    if (hit) return new Response(hit);
    fetched = true;
    return fetch(expand(terrainRenderUrl(origin), tile), { signal: requestSignal });
  });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const bitmap = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none' });
  try {
    signal.throwIfAborted();
    if (bitmap.width !== tileSize || bitmap.height !== tileSize) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = tileSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const heights = decodeTerrain(context.getImageData(0, 0, tileSize, tileSize).data);
    if (fetched) store().put(key,bytes);
    return heights;
  } finally {
    bitmap.close();
  }
}
