import type { OvmapTileLayer } from './types';
import { renderOvmapTemplate } from './ovmapTemplates';
import { fetchMapTile, tileResponseError } from './tileTransport';

function tileCanvas() {
  if (typeof OffscreenCanvas === 'function') {
    try {
    const canvas = new OffscreenCanvas(256, 256);
    const context = canvas.getContext('2d');
    if (context && typeof canvas.convertToBlob === 'function') return { context, blob: () => canvas.convertToBlob({ type: 'image/png' }) };
    } catch { /* Fall back to the document canvas when the WebView exposes only a stub. */ }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) return { context, blob: () => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图源影像编码失败')), 'image/png')) };
  }
  throw new Error('无法初始化图源影像');
}

/** Render only the imported raster stack; track/map coordinates remain unchanged. */
export async function renderOvmapTile(layers: OvmapTileLayer[], z: number, x: number, y: number, signal: AbortSignal, onPartial?: () => void): Promise<ArrayBuffer> {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new Error('无效图源瓦片坐标');
  const base = layers[0];
  if (!base || z < base.minzoom || z > base.maxzoom) throw new Error('此级别没有图源底图');
  const active = [base, ...layers.slice(1).filter(layer => z >= layer.minzoom && z <= layer.maxzoom)];
  // Single-layer tiles need no canvas; some mobile WebViews lack OffscreenCanvas 2D.
  let canvas: ReturnType<typeof tileCanvas> | undefined;
  let drawn = 0;
  let baseBytes: ArrayBuffer | undefined;
  for (const [index, layer] of active.entries()) {
    signal.throwIfAborted();
    const requestAbort = new AbortController();
    const cancel = () => requestAbort.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    // Optional labels must not keep an otherwise usable base tile waiting.
    const timeout = index > 0 ? setTimeout(() => requestAbort.abort(), 2500) : undefined;
    try {
      const template = layer.tiles[(x + y) % layer.tiles.length];
      const address = renderOvmapTemplate(template, z, x, y).replaceAll('{', '%7B').replaceAll('}', '%7D');
      const response = await fetchMapTile(address, requestAbort.signal);
      if (!response.ok) throw tileResponseError(response);
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      if (index === 0 && !layer.subdivide) baseBytes = bytes;
      if (!layer.subdivide && active.length === 1) return bytes;
      canvas ??= tileCanvas();
      const ctx = canvas.context;
      const bitmap = await createImageBitmap(new Blob([bytes]));
      try {
        signal.throwIfAborted();
        if (layer.subdivide) {
          const w = bitmap.width / 2, h = bitmap.height / 2;
          ctx.drawImage(bitmap, (x % 2) * w, (y % 2) * h, w, h, 0, 0, 256, 256);
        } else ctx.drawImage(bitmap, 0, 0, 256, 256);
        drawn++;
      } finally { bitmap.close(); }
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
  return (await canvas!.blob()).arrayBuffer();
}
