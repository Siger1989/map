import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

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
