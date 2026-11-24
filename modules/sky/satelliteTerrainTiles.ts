import { basemapConfiguration, tiandituTiles } from '../cartography/basemaps';
import { isKnownNoImageryBytes } from '../mapSources/noImageryTile';
import { fetchTiandituResponse } from '../mapSources/tiandituProtocol';
import { isTiandituTileUrl } from '../mapSources/tiandituLoader';
import { fetchMapTile } from '../mapSources/tileTransport';
import type { MapSource } from '../mapSources/types';
import { createBrowserTileCache } from '../mapSources/browserTileCache';
import { cachedMapFetch } from '../outdoor/tileCache';
import { decodeTerrain } from '../section/terrainMath';
import { TERRAIN_URL, terrainRenderUrl } from '../terrain/tiles';
import type { Tile } from './satelliteTerrainGeometry';
import { loadExactJourneyRaster } from './journeyImagery';

const tileSize = 256;
function journeyImagerySignal(signal: AbortSignal) {
  // The Android asset gateway can spend up to 12 seconds on a tile.
  const budgetMs = location.hostname === 'appassets.androidplatform.net' ? 13_000 : 3_500;
  return AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]);
}
let nativeImageryRetryAt = 0;
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

function pauseNativeImageryAfterRateLimit(response: Response) {
  if (response.status !== 429 && response.status !== 503) return;
  const now = Date.now();
  const header = response.headers.get('Retry-After');
  const time = header && (/^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header));
  nativeImageryRetryAt = Math.max(nativeImageryRetryAt, typeof time === 'number' && Number.isFinite(time) && time > now ? time : now + 30_000);
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

export async function loadSatelliteTile(tile: Tile, signal: AbortSignal, remember?: (image:Blob)=>void, journey = false) {
  const { token } = basemapConfiguration();
  const template = tiandituTiles('img', token)[0];
  const url = expand(template, tile);
  const key = 'tdt-img/' + tile.key;
  let fetched = false;
  const imagerySignal = journey ? journeyImagerySignal(signal) : signal;
  const response = location.hostname === 'appassets.androidplatform.net'
    ? await cachedMapFetch(url,imagerySignal,undefined,true,async (request,requestSignal) => {
      const hit = await store().get(key);
      requestSignal.throwIfAborted();
      if (hit) return new Response(hit);
      if (journey && Date.now() < nativeImageryRetryAt) return new Response(null, { status: 429 });
      fetched = true;
      const result = await fetchAndroidImagery(request, requestSignal);
      if (journey) pauseNativeImageryAfterRateLimit(result);
      return result;
    })
    : await fetchTiandituResponse(url, imagerySignal, journey);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (await isKnownNoImageryBytes(bytes)) return null;
  imagerySignal.throwIfAborted();
  const image = new Blob([bytes]);
  const bitmap = await createImageBitmap(image);
  if (imagerySignal.aborted || bitmap.width !== tileSize || bitmap.height !== tileSize) {
    bitmap.close();
    imagerySignal.throwIfAborted();
    return null;
  }
  if (fetched) store().put(key,bytes);
  remember?.(image);
  return bitmap;
}

function fetchJourneyRaster(url: string, signal: AbortSignal) {
  const address = new URL(url, location.origin);
  if (address.origin === location.origin) return cachedMapFetch(address.href, signal);
  if (!isTiandituTileUrl(url)) return fetchMapTile(url, signal);
  if (location.hostname !== 'appassets.androidplatform.net') return fetchTiandituResponse(url, signal, true);
  return cachedMapFetch(url, signal, undefined, true, async (request, requestSignal) => {
    const digest = await globalThis.crypto?.subtle?.digest('SHA-256', new TextEncoder().encode(request)).catch(() => undefined);
    const key = digest && 'journey-tdt/' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const hit = key && await store().get(key);
    requestSignal.throwIfAborted();
    if (hit) return new Response(hit);
    if (Date.now() < nativeImageryRetryAt) return new Response(null, { status: 429 });
    const response = await fetchAndroidImagery(request, requestSignal);
    pauseNativeImageryAfterRateLimit(response);
    if (!response.ok) return response;
    const bytes = await response.arrayBuffer();
    if (await isKnownNoImageryBytes(bytes)) return new Response(null, { status: 404 });
    if (key) store().put(key, bytes);
    return new Response(bytes, { headers: response.headers });
  });
}

export async function loadJourneyImageryTile(source: MapSource, tile: Tile, signal: AbortSignal, remember?: (image: Blob) => void) {
  return loadExactJourneyRaster(source, tile, fetchJourneyRaster, journeyImagerySignal(signal), remember);
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
