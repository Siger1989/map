import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../modules/sky/journeyImagery.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'unused-worker-url', setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker-url', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default "worker.js"' }));
  } }],
});
const { loadExactJourneyRaster } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));

test('journey uses the selected Bing-style OVMAP quadkey and rejects unavailable exact levels', async () => {
  const source = {
    id: 'bing-19-fixture', name: '必应卫星图（19级）', kind: 'online', format: 'OVMAP', attribution: '',
    minzoom: 1, maxzoom: 18, tileSize: 256, bytes: 0, datum: 'wgs84',
    ovmap: { layers: [{ minzoom: 1, maxzoom: 18, tileSize: 256, tiles: ['https://bing.example.test/a{$x}{$y}{$z}{4}.jpg'] }] },
  };
  const tile = { z: 18, x: 1, y: 2, key: '18/1/2' };
  const signal = new AbortController().signal;
  const requests = [];
  let remembered;
  const bitmap = { width: 256, height: 256, close() {} };
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => bitmap;
  try {
    const fetch = async address => {
      requests.push(address);
      return new Response('fixture-image');
    };
    assert.equal(await loadExactJourneyRaster(source, { ...tile, z: 19 }, fetch, signal), null);
    assert.equal(await loadExactJourneyRaster({ ...source, kind: 'mbtiles' }, tile, fetch, signal), null);
    assert.equal(await loadExactJourneyRaster({ ...source, bounds: [100, 20, 130, 40] }, tile, fetch, signal), null);
    assert.deepEqual(requests, []);

    const result = await loadExactJourneyRaster(source, tile, fetch, signal, bytes => { remembered = bytes; });
    assert.equal(result, bitmap);
    assert.equal(await remembered.text(), 'fixture-image');
    assert.deepEqual(requests, ['https://bing.example.test/a000000000000000021.jpg']);

    const noTile = async address => {
      requests.push(address);
      return new Response('provider placeholder', { headers: { 'X-VE-Tile-Info': 'no-tile' } });
    };
    assert.equal(await loadExactJourneyRaster(source, tile, noTile, signal), null);
    assert.equal(requests.length, 2);
    assert.equal(requests[1], requests[0]);

    const different = { ...source, id: 'different', ovmap: undefined, scheme: 'tms', tiles: ['https://tms.example.test/{z}/{x}/{y}'] };
    assert.equal(await loadExactJourneyRaster(different, tile, fetch, signal), bitmap);
    assert.equal(requests.at(-1), 'https://tms.example.test/18/1/262141');
  } finally {
    globalThis.createImageBitmap = original;
  }
});
