import { basemapConfiguration, tiandituTiles } from '../cartography/basemaps';
import { isKnownNoImageryBytes } from '../mapSources/noImageryTile';
import { fetchTiandituResponse } from '../mapSources/tiandituProtocol';
import { cachedMapFetch, offlineMapOnly } from '../outdoor/tileCache';
import { decodeTerrain } from '../section/terrainMath';
import { TERRAIN_URL, terrainRenderUrl } from '../terrain/tiles';
import type { Tile } from './satelliteTerrainGeometry';

const tileSize = 256;

function expand(template: string, { z, x, y }: Tile) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

type NativeTileBridge = { cancelMapTile?: (requestId: string) => void };

function fetchAndroidImagery(url: string, signal: AbortSignal) {
  return cachedMapFetch(url, signal, undefined, true, async (request, requestSignal) => {
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
  });
}

export function satelliteImageryAvailable() {
  return basemapConfiguration().domestic && !offlineMapOnly();
}

export async function loadSatelliteTile(tile: Tile, signal: AbortSignal) {
  const { token } = basemapConfiguration();
  const template = tiandituTiles('img', token)[0];
  const url = expand(template, tile);
  const response = location.hostname === 'appassets.androidplatform.net'
    ? await fetchAndroidImagery(url, signal)
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
  return bitmap;
}

export async function loadSatelliteDem(tile: Tile, signal: AbortSignal) {
  const origin = location.origin;
  const response = await cachedMapFetch(expand(origin + TERRAIN_URL, tile), signal, undefined, false,
    (_, requestSignal) => fetch(expand(terrainRenderUrl(origin), tile), { signal: requestSignal }));
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    signal.throwIfAborted();
    if (bitmap.width !== tileSize || bitmap.height !== tileSize) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = tileSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return decodeTerrain(context.getImageData(0, 0, tileSize, tileSize).data);
  } finally {
    bitmap.close();
  }
}
