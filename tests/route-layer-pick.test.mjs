import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { handlePlannedRoutePick } from '../modules/map/trackEditClick.ts';

const bundle = await build({
  entryPoints: ['modules/navigation/RouteLayer.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { RouteLayer } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('a planned route can be selected on the map and stops responding after clearing', () => {
  const layers = new Map();
  const sources = new Map();
  let queried = false;
  const map = {
    getSource: (id) => sources.get(id),
    addSource: (id) => sources.set(id, { setData() {} }),
    getLayer: (id) => layers.get(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    queryRenderedFeatures: (_bounds, options) => {
      queried = true;
      assert.ok(options.layers.includes('route-path'));
      return [{ properties: { kind: 'road' } }];
    },
  };
  const routeLayer = new RouteLayer(map);
  assert.equal(routeLayer.pick({ x: 100, y: 100 }), false);
  routeLayer.sync({
    route: { coordinates: [[103, 30], [103.01, 30.01]] },
    start: null,
    end: null,
  });
  assert.equal(routeLayer.pick({ x: 100, y: 100 }), true);
  assert.equal(queried, true);
  routeLayer.sync({ route: null, start: null, end: null });
  queried = false;
  assert.equal(routeLayer.pick({ x: 100, y: 100 }), false);
  assert.equal(queried, false);
});

test('a hit planned route wins before an overlapping saved-track hit', () => {
  const layers = new Map();
  const sources = new Map();
  const map = {
    getSource: id => sources.get(id),
    addSource: (id) => sources.set(id, { setData() {} }),
    getLayer: id => layers.get(id),
    addLayer: layer => layers.set(layer.id, layer),
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    queryRenderedFeatures: (_bounds, options) => options.layers.includes('route-path')
      ? [{ properties: { kind: 'road' } }]
      : [],
  };
  const route = new RouteLayer(map);
  route.sync({ route: { coordinates: [[103, 30], [103.01, 30.01]] }, start: null, end: null });
  const selected = [];
  let savedTrackPickCalls = 0;
  const pickSavedTrack = () => { savedTrackPickCalls += 1; return 'saved-route'; };

  if (!handlePlannedRoutePick(() => route.pick({ x: 100, y: 100 }), () => selected.push('planned-route'))) {
    const track = pickSavedTrack();
    if (track) selected.push('saved-track');
  }

  assert.deepEqual(selected, ['planned-route']);
  assert.equal(savedTrackPickCalls, 0, 'track hit testing is skipped when the blue route is hit');
});
