import test from 'node:test';
import assert from 'node:assert/strict';
import { fromWgs84, warpPlan, worldPixel, WARP_GRID, rasterPixelPlan } from '../modules/mapSources/coordinates.ts';
import { resampleRasterPixels } from '../modules/mapSources/rasterResampler.ts';

test('retina pixel plan preserves geography and all samples without changing tile addresses', () => {
  const plan = warpPlan(19, 413017, 214621, 256, 'gcj02');
  const retina = rasterPixelPlan(plan, 512);
  assert.equal(retina.tileSize, 512);
  for (const key of ['left','top','width','height']) assert.equal(retina[key], plan[key]);
  assert.deepEqual(retina.points, plan.points.map(value => value * 2));
  assert.deepEqual(rasterPixelPlan(retina, 256), plan);
  assert.equal(rasterPixelPlan(plan, 4096), plan);
});

// Kept byte-for-byte equivalent to the previous worker loop as the output oracle.
function referenceRasterPixels(p, input) {
  const s = p.tileSize;
  const mosaicWidth = p.width * s;
  const mosaicHeight = p.height * s;
  const output = new Uint8ClampedArray(s * s * 4);
  const step = s / WARP_GRID;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const gx = (x + 0.5) / step, gy = (y + 0.5) / step;
    const col = Math.floor(gx), row = Math.floor(gy), dx = gx - col, dy = gy - row;
    const a = (row * (WARP_GRID + 1) + col) * 2, b = a + 2, c = a + (WARP_GRID + 1) * 2, d = c + 2;
    const interp = (axis) => (p.points[a + axis] * (1 - dx) + p.points[b + axis] * dx) * (1 - dy) + (p.points[c + axis] * (1 - dx) + p.points[d + axis] * dx) * dy;
    const sx = Math.max(0, Math.min(mosaicWidth - 1.001, interp(0) - p.left * s - 0.5));
    const sy = Math.max(0, Math.min(mosaicHeight - 1.001, interp(1) - p.top * s - 0.5));
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const at = (iy * mosaicWidth + ix) * 4, to = (y * s + x) * 4;
    const indices = [at, at + 4, at + mosaicWidth * 4, at + (mosaicWidth + 1) * 4];
    const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    const alpha = indices.reduce((value, index, i) => value + input[index + 3] * weights[i], 0);
    for (let channel = 0; channel < 3; channel++)
      output[to + channel] = alpha ? indices.reduce((value, index, i) => value + input[index + channel] * input[index + 3] * weights[i], 0) / alpha : 0;
    output[to + 3] = alpha;
  }
  return output;
}

function makeFixture(tileSize, datum, zoom, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  const lng = 73 + (random() / 0x100000000) * 60;
  const lat = 18 + (random() / 0x100000000) * 34;
  const [px, py] = worldPixel(...fromWgs84(lng, lat, 'wgs84'), tileSize * 2 ** zoom);
  const plan = warpPlan(zoom, Math.floor(px / tileSize), Math.floor(py / tileSize), tileSize, datum);
  const width = plan.width * tileSize, height = plan.height * tileSize;
  const input = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, value = random();
    // Include hard transparent edges, partial alpha, and arbitrary color under zero alpha.
    input[i] = value >>> 24;
    input[i + 1] = value >>> 16;
    input[i + 2] = value >>> 8;
    input[i + 3] = (x % 47 < 7 || y % 53 < 9) ? 0 : [64, 128, 192, 255][value & 3];
  }
  return { plan, input };
}

test('scalar raster resampling is byte-identical for transparent edges across zooms and tile sizes', () => {
  for (const tileSize of [256, 512]) for (const datum of ['gcj02', 'bd09'])
    for (const zoom of [5, 9, 14, 19]) for (let sample = 0; sample < 2; sample++) {
      const { plan, input } = makeFixture(tileSize, datum, zoom, 0x51a700 + zoom * 11 + sample);
      const expected = referenceRasterPixels(plan, input);
      const actual = resampleRasterPixels(plan, input);
      assert.equal(actual.length, expected.length, `${tileSize}px ${datum} z${zoom} output size`);
      for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i], expected[i], `${tileSize}px ${datum} z${zoom} sample ${sample}, byte ${i}`);
      }
    }
});

test('resampler writes into the supplied ImageData buffer', () => {
  const { plan, input } = makeFixture(256, 'gcj02', 12, 42);
  const output = new Uint8ClampedArray(256 * 256 * 4);
  assert.equal(resampleRasterPixels(plan, input, output), output);
  assert.deepEqual(output, referenceRasterPixels(plan, input));
});
