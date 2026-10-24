import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['modules/cartography/RasterDetailPatch.ts', 'modules/cartography/detailPatch.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, outdir: '.openai/raster-detail-tests',
  plugins: [{ name: 'mock-map-cache', setup(build) {
    build.onResolve({ filter: /\.\.\/outdoor\/tileCache$/ }, () => ({ path: 'tile-cache', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const cachedMapFetch=async()=>new Response(new Uint8Array([1]));' }));
  } }],
});
const modules = await Promise.all(bundled.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`)));
const { RasterDetailPatch } = modules.find(module => module.RasterDetailPatch);
const { detailPatch } = modules.find(module => module.detailPatch);

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const keys = ['window', 'document', 'createImageBitmap', 'CustomEvent'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  const drawn = [], closed = [];
  const context = { drawImage(bitmap) { drawn.push(bitmap.id); } };
  globalThis.document = { createElement: () => ({
    width: 0, height: 0, getContext: () => context, toDataURL: () => 'data:image/png;base64,fixture',
  }) };
  globalThis.createImageBitmap = async () => {
    const bitmap = { id: closed.length + drawn.length + Math.random(), close() { closed.push(this.id); } };
    return bitmap;
  };
  const sources = new Map([['overview', { id: 'overview', type: 'raster', scheme: 'xyz', tiles: ['https://tiles.test/{z}/{x}/{y}.png'] }]]);
  const layers = [{ id: 'overview-layer', type: 'raster', source: 'overview' }];
  const state = { sources, layers, addedLayers: [], addedSources: [], removedLayers: [], removedSources: [], updatedImages: 0 };
  const map = {
    on(_event, handler) { state.handler = handler; },
    off() {},
    getSource(id) { return sources.get(id); },
    getLayer(id) { return layers.find(layer => layer.id === id); },
    removeLayer(id) { state.removedLayers.push(id); const index = layers.findIndex(layer => layer.id === id); if (index >= 0) layers.splice(index, 1); },
    removeSource(id) { state.removedSources.push(id); sources.delete(id); },
    addSource(id, source) {
      state.addedSources.push({ id, source });
      state.bitmapCountAtAdd = { drawn: drawn.length, closed: closed.length };
      sources.set(id, { ...source, updateImage() { state.updatedImages++; } });
    },
    addLayer(layer) { state.addedLayers.push(layer); layers.push(layer); },
    getStyle() { return { layers: [...layers] }; },
    getCenter() { return { lng: 0, lat: 0 }; },
    getBounds() { return state.bounds ?? ({ getWest: () => -30, getSouth: () => -25, getEast: () => 30, getNorth: () => 25 }); },
  };
  return { map, state, drawn, closed };
}

const response = { ok: true, blob: async () => ({}) };
async function waitFor(predicate, message) {
  for (let i = 0; i < 100 && !predicate(); i++) await tick();
  assert.ok(predicate(), message);
}
async function settleBatches(requests, from, to) {
  for (let i = from; i < to; i++) requests[i].gate.resolve(response);
  await tick(); await tick();
}
async function finishTiles(requests, from, expected) {
  while (from < expected) {
    await waitFor(() => requests.length > from, 'remaining tile work should start');
    const to = Math.min(requests.length, expected);
    assert.ok(to - from <= 8, 'each wave remains bounded to eight active requests');
    await settleBatches(requests, from, to);
    from = to;
  }
}

test('fixed-detail view starts eight tiles at once, gates the ninth, closes bitmaps, and adds the image', async t => {
  const { map, state, drawn, closed } = fixture(t);
  const requests = [];
  const patch = new RasterDetailPatch(map, (url, signal) => {
    const gate = deferred(); requests.push({ url, signal, gate }); return gate.promise;
  });
  patch.sync('overview', 5);
  const expectedTiles = detailPatch(0, 0, 5, [-30, -25, 30, 25]).tiles.length;
  await waitFor(() => requests.length === 8, 'initial batch should fill eight slots');
  assert.equal(requests.length, 8);
  await settleBatches(requests, 0, 8);
  await waitFor(() => requests.length > 8, 'the next batch should start after active requests finish');
  assert.equal(requests.length, 16, 'only the first eight can start before any response settles');
  await finishTiles(requests, 8, expectedTiles);
  await waitFor(() => state.addedSources.length === 1, 'completed fixed-detail patch should submit an image source');
  assert.ok(requests.length > 8, 'the view fixture covers more than eight tiles');
  assert.equal(requests.length, expectedTiles);
  assert.equal(drawn.length, requests.length);
  assert.equal(closed.length, drawn.length, 'all decoded bitmaps are closed after drawing');
  assert.deepEqual(state.bitmapCountAtAdd, { drawn: expectedTiles, closed: expectedTiles }, 'every bitmap is closed before output submission');
  assert.equal(state.addedLayers.length, 1);
  assert.equal(state.addedLayers[0].source, 'shantu-fixed-detail');
  patch.dispose();
});

test('changing the view aborts the old request set and prevents its output from being committed', async t => {
  const { map, state, drawn, closed } = fixture(t);
  const requests = [];
  const patch = new RasterDetailPatch(map, (url, signal) => {
    const gate = deferred(); requests.push({ url, signal, gate }); return gate.promise;
  });
  patch.sync('overview', 5);
  await waitFor(() => requests.length === 8, 'old view should start its first bounded batch');
  const oldRequests = requests.slice(0, 8);

  const newBounds = [45, -25, 105, 25];
  state.bounds = { getWest: () => newBounds[0], getSouth: () => newBounds[1], getEast: () => newBounds[2], getNorth: () => newBounds[3] };
  const newTileCount = detailPatch(0, 0, 5, newBounds).tiles.length;
  state.handler();
  await waitFor(() => requests.length > 8, 'new view should begin after old work is cancelled');
  assert.ok(oldRequests.every(request => request.signal.aborted), 'view change aborts every old in-flight request');
  for (const request of oldRequests) request.gate.resolve(response);
  await tick(); await tick();
  assert.equal(state.addedSources.length, 0, 'an aborted old view cannot publish an image source');
  assert.equal(state.addedLayers.length, 0);
  assert.equal(closed.length, drawn.length, 'any decoded old-view bitmap is closed');

  const newRequests = requests.slice(8);
  assert.ok(newRequests.every(request => !request.signal.aborted));
  await finishTiles(requests, 8, 8 + newTileCount);
  for (let i = 0; i < 100 && state.addedSources.length === 0; i++) await tick();
  assert.equal(state.addedSources.length, 1, 'new view may publish after all its tiles finish');
  assert.equal(state.addedLayers.length, 1);
  assert.equal(closed.length, drawn.length);
  patch.dispose();
});
