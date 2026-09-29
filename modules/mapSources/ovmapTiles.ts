import type { OvmapTileLayer } from './types';
import { renderOvmapTemplate } from './ovmapTemplates';
import { fetchMapTile } from './tileTransport';

/** Render only the imported raster stack; track/map coordinates remain unchanged. */
export async function renderOvmapTile(layers: OvmapTileLayer[], z: number, x: number, y: number, signal: AbortSignal, onPartial?: () => void): Promise<ArrayBuffer> {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z)
    throw new Error('无效图源瓦片坐标');
  const base = layers[0];
  if (!base || z < base.minzoom || z > base.maxzoom) throw new Error('此级别没有图源底图');
  const active = [base, ...layers.slice(1).filter(layer => z >= layer.minzoom && z <= layer.maxzoom)];
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法初始化图源影像');
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
      if (!response.ok) throw new Error(`图源瓦片暂不可用 (${response.status})`);
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      if (index === 0 && !layer.subdivide) baseBytes = bytes;
      if (!layer.subdivide && active.length === 1) return bytes;
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
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
