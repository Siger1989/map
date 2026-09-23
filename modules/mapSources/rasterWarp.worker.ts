import { WARP_GRID, type WarpPlan } from './coordinates';

// One bounded tile per worker. Heavy decoding/resampling never runs on the UI thread.
self.onmessage = async ({ data }: MessageEvent<{ plan: WarpPlan; tiles: ArrayBuffer[] }>) => {
  try {
    const { plan: p, tiles } = data, s = p.tileSize;
    const mosaic = new OffscreenCanvas(p.width * s, p.height * s);
    const ctx = mosaic.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw Error('无法初始化坐标校正');
    for (let i = 0; i < tiles.length; i++) {
      const bitmap = await createImageBitmap(new Blob([tiles[i]]));
      try { ctx.drawImage(bitmap, (i % p.width) * s, Math.floor(i / p.width) * s, s, s); }
      finally { bitmap.close(); }
    }
    const input = ctx.getImageData(0, 0, mosaic.width, mosaic.height).data;
    const out = new OffscreenCanvas(s, s), context = out.getContext('2d');
    if (!context) throw Error('无法初始化坐标校正');
    const result = context.createImageData(s, s), step = s / WARP_GRID;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const gx = (x + 0.5) / step, gy = (y + 0.5) / step;
      const col = Math.floor(gx), row = Math.floor(gy), dx = gx - col, dy = gy - row;
      const a = (row * (WARP_GRID + 1) + col) * 2, b = a + 2, c = a + (WARP_GRID + 1) * 2, d = c + 2;
      const interp = (axis: number) => (p.points[a + axis] * (1 - dx) + p.points[b + axis] * dx) * (1 - dy) + (p.points[c + axis] * (1 - dx) + p.points[d + axis] * dx) * dy;
      const sx = Math.max(0, Math.min(mosaic.width - 1.001, interp(0) - p.left * s - 0.5));
      const sy = Math.max(0, Math.min(mosaic.height - 1.001, interp(1) - p.top * s - 0.5));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const at = (iy * mosaic.width + ix) * 4, to = (y * s + x) * 4;
      // Premultiplied alpha avoids dark fringes around transparent labels/tiles.
      const indices = [at, at + 4, at + mosaic.width * 4, at + (mosaic.width + 1) * 4];
      const weights = [(1-fx)*(1-fy), fx*(1-fy), (1-fx)*fy, fx*fy];
      const alpha = indices.reduce((v, index, i) => v + input[index + 3] * weights[i], 0);
      for (let channel = 0; channel < 3; channel++) result.data[to + channel] = alpha ? indices.reduce((v, index, i) => v + input[index + channel] * input[index + 3] * weights[i], 0) / alpha : 0;
      result.data[to + 3] = alpha;
    }
    context.putImageData(result, 0, 0);
    const bytes = await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer();
    self.postMessage({ bytes }, { transfer: [bytes] });
  } catch { self.postMessage({ error: '坐标校正失败，请检查图源或恢复 WGS84' }); }
};
