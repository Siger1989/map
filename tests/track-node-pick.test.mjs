import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['modules/tracks/TrackLayer.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { TrackLayer } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('visible route-node hits use a 44px independent query and deterministic nearest tie break', () => {
  let hits = [];
  let queryBox;
  const map = {
    getLayer: id => id === 'manual-track-node' ? {} : undefined,
    queryRenderedFeatures(box) { queryBox = box; return hits; },
    project: ([longitude, latitude]) => ({ x: (longitude - 104) * 100000, y: (latitude - 30) * 100000 }),
  };
  const layer = new TrackLayer(map);
  hits = [
    { properties: { trackId: 'z-route', lng: 104.0001, lat: 30 } },
    { properties: { trackId: 'a-route', lng: 103.9999, lat: 30 } },
    { properties: { trackId: 'nearest', lng: 104.00002, lat: 30 } },
  ];
  const nearest = layer.pickNode({ x: 0, y: 0 });
  assert.equal(nearest.trackId, 'nearest');
  assert.deepEqual(queryBox, [[-22, -22], [22, 22]], 'the 44px query is separate from the 4px painted node');

  hits = [
    { properties: { trackId: 'z-route', lng: 104.0001, lat: 30 } },
    { properties: { trackId: 'a-route', lng: 103.9999, lat: 30 } },
  ];
  const tiedForward = layer.pickNode({ x: 0, y: 0 });
  hits.reverse();
  const tiedReverse = layer.pickNode({ x: 0, y: 0 });
  assert.equal(tiedForward.trackId, 'a-route');
  assert.deepEqual(tiedReverse, tiedForward, 'equal-distance nodes do not depend on renderer feature order');
});
