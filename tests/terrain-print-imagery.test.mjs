import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../modules/terrainPrint/modelImagery.ts', import.meta.url))],
  format: 'esm', platform: 'node', bundle: true, write: false,
  plugins: [{
    name: 'test-imagery-loader',
    setup(context) {
      context.onResolve({ filter: /satelliteTerrainTiles$/ }, () => ({ path: 'tiles', namespace: 'fixture' }));
      context.onLoad({ filter: /^tiles$/, namespace: 'fixture' }, () => ({
        contents: 'export const loadJourneyImageryTile = (...args) => globalThis.terrainModelTileFixture(...args)',
      }));
    },
  }],
});
const { canUseTerrainModelImagery, terrainModelImagery } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64')
);

const source = {
  id: 'test', name: 'test', kind: 'online', format: 'XYZ', attribution: '', bytes: 0,
  minzoom: 12, maxzoom: 19, tileSize: 256, tiles: ['https://example.invalid/{z}/{x}/{y}.png'],
};
const selection = { bounds: { west: 1, south: 48, east: 1.01, north: 48.01 }, shape: 'rectangle' };

function fixture(t, missing = false) {
  const tiles = [];
  const surfaces = [];
  let active = 0, maxActive = 0, closed = 0;
  globalThis.terrainModelTileFixture = async (_source, tile, signal) => {
    tiles.push(tile);
    maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    signal.throwIfAborted();
    return missing ? null : { close() { closed++; } };
  };
  globalThis.document = {
    createElement(type) {
      assert.equal(type, 'canvas');
      const draws = [];
      const canvas = {
        draws,
        getContext(kind) {
          assert.equal(kind, '2d');
          return { drawImage: (...args) => draws.push(args) };
        },
        toBlob: (notify, mime) => notify(new Blob(['png bytes'], { type: mime })),
      };
      surfaces.push(canvas);
      return canvas;
    },
  };
  t.after(() => { delete globalThis.document; delete globalThis.terrainModelTileFixture; });
  return { tiles, surfaces, maxActive: () => maxActive, closed: () => closed };
}

test('terrain texture crops real same-source tiles north-up with bounded concurrency and output size', async (t) => {
  const { tiles, surfaces, maxActive, closed } = fixture(t);
  const result = await terrainModelImagery(selection, source, new AbortController().signal);
  assert.equal(result.type, 'image/png');
  assert.ok(tiles.length > 1 && tiles.length <= 36);
  assert.ok(maxActive() <= 4);
  assert.equal(closed(), tiles.length);
  const [mosaic, output] = surfaces;
  assert.equal(mosaic.draws.length, tiles.length);
  assert.ok(output.width > 1 && output.width < output.height);
  assert.ok(output.height <= 1024);
  assert.equal(output.draws.length, output.height);
  assert.equal(output.draws[0][0], mosaic);
  assert.equal(output.draws[0][6], 0);
  assert.equal(output.draws.at(-1)[6], output.height - 1);
  for (let index = 1; index < output.height; index++) assert.ok(output.draws[index][2] > output.draws[index - 1][2]);
});

test('circle texture is square and invalid or unavailable coverage remains an error', async (t) => {
  const { tiles, surfaces } = fixture(t);
  await terrainModelImagery({ ...selection, shape: 'circle' }, source, new AbortController().signal);
  assert.equal(surfaces[1].width, surfaces[1].height);
  const count = tiles.length;
  assert.equal(canUseTerrainModelImagery({ ...source, kind: 'image' }), false);
  assert.equal(canUseTerrainModelImagery({ ...source, format: 'MVT' }), false);
  await assert.rejects(terrainModelImagery(selection, { ...source, bounds: [1, 48, 1.005, 48.01] }, new AbortController().signal), /未覆盖整个模型范围/);
  await assert.rejects(terrainModelImagery(selection, { ...source, minzoom: 24, maxzoom: 24 }, new AbortController().signal), /没有可读取的影像级别/);
  assert.equal(tiles.length, count);
});

test('missing tiles fail instead of emitting a synthetic texture', async (t) => {
  const { surfaces } = fixture(t, true);
  await assert.rejects(terrainModelImagery(selection, source, new AbortController().signal), /影像瓦片缺失/);
  assert.equal(surfaces.length, 1);
});
