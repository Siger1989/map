import type { MapSource, OvmapTileLayer } from './types';
import { SOURCE_ID } from './types';
import { renderOvmapTemplate } from './ovmapTemplates';
import { fetchMapTile, tileResponseError } from './tileTransport';
import { cropRasterTile, fetchWithParentFallback, isKnownNoImageryBytes, isNoImageryResponse, NoImageryTileError } from './noImageryTile.ts';

function outputTileSize(layer: OvmapTileLayer) {
  const size = layer.subdivide ? layer.tileSize / 2 : layer.tileSize;
  if (!Number.isInteger(size) || size < 1) throw new Error('图源瓦片尺寸无效');
  return size;
}

function tileCanvas(size: number) {
  if (typeof OffscreenCanvas === 'function') {
    try {
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d');
      if (context && typeof canvas.convertToBlob === 'function')
        return { context, blob: () => canvas.convertToBlob({ type: 'image/png' }) };
    } catch { /* Fall back to the document canvas when the WebView exposes only a stub. */ }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) return { context, blob: () => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图源影像编码失败')), 'image/png')) };
  }
  throw new Error('无法初始化图源影像');
}

function tileAddress(layer: OvmapTileLayer, z: number, x: number, y: number) {
  const template = layer.tiles[(x + y) % layer.tiles.length];
  return renderOvmapTemplate(template, z, x, y).replaceAll('{', '%7B').replaceAll('}', '%7D');
}

function validateTile(layer: OvmapTileLayer, z: number, x: number, y: number) {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new Error('无效图源瓦片坐标');
  if (!layer || z < layer.minzoom || z > layer.maxzoom || !layer.tiles?.length)
    throw new Error('此级别没有图源瓦片');
}

/** One independently rendered OVMAP source. Unmodified provider images are returned byte-for-byte. */
export async function renderOvmapLayerTile(layer: OvmapTileLayer, z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  validateTile(layer, z, x, y);
  signal.throwIfAborted();
  const fetchRaw = async (tileZ:number,tileX:number,tileY:number,childSignal:AbortSignal) => {
    const response = await fetchMapTile(tileAddress(layer,tileZ,tileX,tileY),childSignal);
    if (isNoImageryResponse(response)) {
      try { void response.body?.cancel().catch(() => {}); } catch { /* Ignore absent-tile body cleanup errors. */ }
      throw new NoImageryTileError();
    }
    if (!response.ok) throw tileResponseError(response);
    const bytes = await response.arrayBuffer();
    childSignal.throwIfAborted();
    if (await isKnownNoImageryBytes(bytes)) throw new NoImageryTileError();
    return bytes;
  };
  const fetchLevel = async (tileZ:number,tileX:number,tileY:number,childSignal:AbortSignal) => {
    const raw = await fetchRaw(tileZ,tileX,tileY,childSignal);
    if (!layer.subdivide) return raw;
    const size = outputTileSize(layer);
    const bitmap = await createImageBitmap(new Blob([raw]));
    try {
      childSignal.throwIfAborted();
      const halfWidth = bitmap.width / 2, halfHeight = bitmap.height / 2;
      if (!Number.isInteger(halfWidth) || !Number.isInteger(halfHeight) || halfWidth !== size || halfHeight !== size)
        throw new Error('父级图源瓦片尺寸与声明不一致');
      const canvas = tileCanvas(size);
      canvas.context.drawImage(bitmap, (tileX % 2) * halfWidth, (tileY % 2) * halfHeight, halfWidth, halfHeight, 0, 0, size, size);
      childSignal.throwIfAborted();
      return (await canvas.blob()).arrayBuffer();
    } finally { bitmap.close(); }
  };
  return fetchWithParentFallback({
    z,x,y,minZoom:layer.minzoom,signal,
    tileKey:(tileZ,tileX,tileY)=>tileAddress(layer,tileZ,tileX,tileY),
    fetchTile:fetchLevel,
    cropTile:(bytes,childX,childY,scale,childSignal)=>cropRasterTile(bytes,childX,childY,scale,childSignal,outputTileSize(layer)),
  });
}

/** Preserve the historical composite helper for offline callers that still request a whole stack. */
export async function renderOvmapTile(layers: OvmapTileLayer[], z: number, x: number, y: number, signal: AbortSignal, onPartial?: () => void): Promise<ArrayBuffer> {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new Error('无效图源瓦片坐标');
  const base = layers[0];
  if (!base || z < base.minzoom || z > base.maxzoom) throw new Error('此级别没有图源底图');
  const active = [base, ...layers.slice(1).filter(layer => z >= layer.minzoom && z <= layer.maxzoom)];
  if (active.length === 1) return renderOvmapLayerTile(base, z, x, y, signal);
  const size = outputTileSize(base);
  const canvas = tileCanvas(size);
  let drawn = 0;
  let baseBytes: ArrayBuffer | undefined;
  for (const [index, layer] of active.entries()) {
    signal.throwIfAborted();
    const requestAbort = new AbortController();
    const cancel = () => requestAbort.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = index > 0 ? setTimeout(() => requestAbort.abort(), 2500) : undefined;
    try {
      const bytes = await renderOvmapLayerTile(layer, z, x, y, requestAbort.signal);
      if (index === 0) baseBytes = bytes;
      const bitmap = await createImageBitmap(new Blob([bytes]));
      try { signal.throwIfAborted(); canvas.context.drawImage(bitmap, 0, 0, size, size); drawn++; }
      finally { bitmap.close(); }
    } catch (error) {
      signal.throwIfAborted();
      if (index === 0) throw error;
      onPartial?.();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    }
  }
  if (!drawn) throw new Error('没有可显示的图源瓦片');
  if (drawn === 1 && baseBytes) return baseBytes;
  return (await canvas.blob()).arrayBuffer();
}

/** The base keeps its historical source ID; optional OVMAP layers get stable derived IDs. */
export function ovmapSourceIds(source: Pick<MapSource, 'id' | 'kind' | 'ovmap'> | null | undefined): string[] {
  if (!source || source.kind === 'image') return [];
  if (!source.ovmap?.layers.length) return [SOURCE_ID];
  return [SOURCE_ID, ...source.ovmap.layers.slice(1).map((_, index) => `${SOURCE_ID}-ovmap-${index + 1}`)];
}

/** MapLibre consumes this many pixels for one logical tile after OVMAP subdivision. */
export function ovmapTileSize(layer: OvmapTileLayer): number {
  return outputTileSize(layer);
}
