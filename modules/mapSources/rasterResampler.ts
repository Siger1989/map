import { WARP_GRID, type WarpPlan } from './coordinates.ts';

/** Bilinearly sample one RGBA mosaic into a single output raster tile. */
export function resampleRasterPixels(
  plan: WarpPlan,
  input: Uint8ClampedArray,
  output = new Uint8ClampedArray(plan.tileSize * plan.tileSize * 4),
): Uint8ClampedArray {
  const { tileSize: size, width, points, left, top } = plan;
  const gridSize = WARP_GRID + 1;
  const step = size / WARP_GRID;
  const mosaicWidth = width * size;
  for (let y = 0; y < size; y++) {
    const gy = (y + 0.5) / step;
    const row = Math.floor(gy);
    const dy = gy - row;
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / step;
      const col = Math.floor(gx);
      const dx = gx - col;
      const a = (row * gridSize + col) * 2;
      const b = a + 2;
      const c = a + gridSize * 2;
      const d = c + 2;
      const topX = points[a] * (1 - dx) + points[b] * dx;
      const bottomX = points[c] * (1 - dx) + points[d] * dx;
      const topY = points[a + 1] * (1 - dx) + points[b + 1] * dx;
      const bottomY = points[c + 1] * (1 - dx) + points[d + 1] * dx;
      const sx = Math.max(0, Math.min(mosaicWidth - 1.001, topX * (1 - dy) + bottomX * dy - left * size - 0.5));
      const sy = Math.max(0, Math.min(plan.height * size - 1.001, topY * (1 - dy) + bottomY * dy - top * size - 0.5));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const at = (iy * mosaicWidth + ix) * 4;
      const i0 = at, i1 = at + 4, i2 = at + mosaicWidth * 4, i3 = i2 + 4;
      const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy);
      const w2 = (1 - fx) * fy, w3 = fx * fy;
      let alpha = 0;
      alpha += input[i0 + 3] * w0;
      alpha += input[i1 + 3] * w1;
      alpha += input[i2 + 3] * w2;
      alpha += input[i3 + 3] * w3;
      const to = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let premultiplied = 0;
        premultiplied += input[i0 + channel] * input[i0 + 3] * w0;
        premultiplied += input[i1 + channel] * input[i1 + 3] * w1;
        premultiplied += input[i2 + channel] * input[i2 + 3] * w2;
        premultiplied += input[i3 + channel] * input[i3 + 3] * w3;
        output[to + channel] = alpha ? premultiplied / alpha : 0;
      }
      output[to + 3] = alpha;
    }
  }
  return output;
}
