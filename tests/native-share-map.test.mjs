import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const bundle = await build({ entryPoints: ['modules/routeShare/mapImage.ts'], bundle: true, platform: 'node',
  format: 'cjs', write: false, logLevel: 'silent', external: ['maplibre-gl'] });
const compiled = { exports: {} };
const require = createRequire(import.meta.url);
const forbiddenWebMap = { Map: class { constructor() { throw new Error('native print created a browser map'); } } };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(compiled, compiled.exports,
  id => id === 'maplibre-gl' ? forbiddenWebMap : require(id));
const { renderRouteMap } = compiled.exports;

test('native route printing uses its native renderer without creating a browser map or requiring DOM', async () => {
  const data = { name: 'native print', segments: [[[0, 0], [0.1, 0.1]]] };
  const signal = new AbortController().signal;
  const canvas = { width: 1200, height: 1250 };
  let calls = 0;
  const result = await renderRouteMap(data, signal, { style: { version: 8, sources: {}, layers: [] }, attribution: 'test',
    renderNative: async (received, receivedSignal) => { calls++; assert.equal(received, data); assert.equal(receivedSignal, signal); return canvas; } });
  assert.equal(result, canvas);
  assert.equal(calls, 1);
});

test('native print errors remain visible instead of falling back to a hidden browser map', async () => {
  await assert.rejects(renderRouteMap({ segments: [] }, new AbortController().signal, {
    style: { version: 8, sources: {}, layers: [] }, attribution: 'test',
    renderNative: async () => { throw new Error('native tile unavailable'); },
  }), /native tile unavailable/);
});

test('a native host that is still starting cannot silently create a browser print fallback', async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'https://appassets.androidplatform.net' }, ShantuNativeMap: { postMessage() {} } };
  try { await assert.rejects(renderRouteMap({ segments: [] }, new AbortController().signal), /原生地图尚未就绪/); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('sharing track B excludes the live planned route A and its navigation position', async () => {
  const nativeBundle = await build({ entryPoints: ['modules/map/native/share.ts'], bundle: true,
    platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const { createNativeShareStyle } = await import(`data:text/javascript;base64,${Buffer.from(nativeBundle.outputFiles[0].text).toString('base64')}`);
  const state = { settings: {}, mapSource: null,
    routeOverlay: { route: { coordinates: [[50, 50], [51, 51]], distance: 1000, duration: 100, mode: 'pedestrian' },
      start: { name: 'A start', coordinates: [50, 50] }, end: { name: 'A end', coordinates: [51, 51] } },
    position: { coordinates: [50, 50] }, positionNavigating: true };
  const before = JSON.stringify(state);
  let payload;
  const sentinel = new Error('captured native print request');
  const style = createNativeShareStyle({ request: async (_map, command, value) => {
    assert.equal(command, 'renderShareMap'); payload = value; throw sentinel;
  } }, 'main', async () => state);
  await assert.rejects(style.renderNative({ name: 'B', segments: [[[1, 1], [2, 2]]], stops: [],
    distance: 1000, duration: null, mode: 'pedestrian', estimated: true }, new AbortController().signal),
    error => error === sentinel);
  assert.deepEqual(payload.geometry.routes.features, []);
  assert.deepEqual(payload.geometry.guidance.features, []);
  const lines = payload.geometry.tracks.features.filter(feature => feature.properties.role === 'track');
  assert.ok(lines.length > 0);
  assert.ok(lines.every(feature => !JSON.stringify(feature.geometry.coordinates).includes('50')));
  assert.ok(lines.every(feature => feature.properties.width === 9));
  const halos = payload.geometry.tracks.features.filter(feature => feature.properties.role === 'shareTrackHalo');
  assert.equal(halos.length, lines.length);
  assert.ok(halos.every(feature => feature.properties.width === 15 && feature.properties.color === '#063537' && !feature.properties.nativePick));
  assert.ok(payload.geometry.tracks.features.indexOf(halos[0]) < payload.geometry.tracks.features.indexOf(lines[0]));
  assert.equal(payload.state.position, null);
  assert.equal(JSON.stringify(state), before);
});
