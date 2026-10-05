import { rasterPixelPlan, type WarpPlan } from './coordinates';
import { resampleRasterPixels } from './rasterResampler.ts';

// One bounded tile per worker. Heavy decoding/resampling never runs on the UI thread.
self.onmessage = async ({ data }: MessageEvent<{ plan: WarpPlan; tiles: ArrayBuffer[] }>) => {
  try {
    const { tiles } = data;
    const first = await createImageBitmap(new Blob([tiles[0]]));
    const p = rasterPixelPlan(data.plan, first.width === first.height ? first.width : data.plan.tileSize), s = p.tileSize;
    const mosaic = new OffscreenCanvas(p.width * s, p.height * s);
    const ctx = mosaic.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw Error('无法初始化坐标校正');
    for (let i = 0; i < tiles.length; i++) {
      const bitmap = i === 0 ? first : await createImageBitmap(new Blob([tiles[i]]));
      try { ctx.drawImage(bitmap, (i % p.width) * s, Math.floor(i / p.width) * s, s, s); }
      finally { bitmap.close(); }
    }
    const input = ctx.getImageData(0, 0, mosaic.width, mosaic.height).data;
    const out = new OffscreenCanvas(s, s), context = out.getContext('2d');
    if (!context) throw Error('无法初始化坐标校正');
    const result = context.createImageData(s, s);
    resampleRasterPixels(p, input, result.data);
    context.putImageData(result, 0, 0);
    const bytes = await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer();
    self.postMessage({ bytes }, { transfer: [bytes] });
  } catch { self.postMessage({ error: '坐标校正失败，请检查图源或恢复 WGS84' }); }
};
