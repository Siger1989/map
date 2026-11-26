import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBuiltinTerrainPrintDem } from '../modules/terrainPrint/builtinDem.ts';
import { terrainPrintStl } from '../modules/terrainPrint/mesh.ts';

const signal = new AbortController().signal;
const patch = (west, south, east, north, shape = 'rectangle') => ({ shape, bounds: { west, south, east, north } });
const flat = () => new Float32Array(256 * 256).fill(4600);

test('samples map pixels across both tile seams at z12, with a north-first, 1:1 ground grid', async () => {
  const loaded = new Set();
  // The four cells meet at [0,0]. Each adjacent quadrant has a distinct constant height.
  const grid = await loadBuiltinTerrainPrintDem(patch(-0.0002, -0.0002, 0.0002, 0.0002), signal,
    async ({ z, x, y, key }) => {
      assert.equal(z, 12);
      assert.ok(!loaded.has(key));
      loaded.add(key);
      return new Float32Array(65536).fill((x - 2047) * 10 + (y - 2047) * 20);
    });
  assert.equal(loaded.size, 4);
  assert.deepEqual([grid.width, grid.height], [3, 3]);
  assert.equal(grid.elevations[0], 0);
  assert.equal(grid.elevations[4], 15);
  assert.equal(grid.elevations.at(-1), 30);
  assert.ok(grid.eastWestMeters > 44 && grid.eastWestMeters < 45);
  assert.ok(grid.northSouthMeters > 44 && grid.northSouthMeters < 45);
  assert.ok(grid.sampleSpacingMeters > 38 && grid.sampleSpacingMeters < 39);
  assert.ok(terrainPrintStl(grid, { shape: 'rectangle', widthMm: 160, baseMm: 4, rimMm: 2 }).byteLength > 84);
});

test('handles large high-latitude squares within the mesh budget and wraps seam neighbours', async () => {
  const tile = flat();
  const levels = new Set();
  const grid = await loadBuiltinTerrainPrintDem(patch(176.8, 79.49, 180, 80, 'circle'), signal,
    async ({ z, x, y }) => {
      levels.add(z);
      assert.ok(x >= 0 && x < 2 ** z && y >= 0 && y < 2 ** z);
      return tile;
    });
  assert.ok(Math.max(...levels) < 12);
  assert.ok(grid.width * grid.height <= 240000);
  assert.ok(grid.elevations.every(h => h !== null && Math.abs(h - 4600) < 1e-8));
});

test('transparent and missing map DEM pixels are never interpreted as zero elevation', async () => {
  const tile = flat(); tile.fill(NaN);
  const selection = patch(86.9245, 27.9878, 86.9255, 27.9884);
  await assert.rejects(loadBuiltinTerrainPrintDem(selection, signal, async () => tile), /没有可读取的地图高程/);
  await assert.rejects(loadBuiltinTerrainPrintDem(selection, signal, async () => null), /没有可读取的地图高程/);
  const stopped = AbortSignal.abort();
  await assert.rejects(loadBuiltinTerrainPrintDem(selection, stopped, () => assert.fail('unexpected request')), { name: 'AbortError' });
});
