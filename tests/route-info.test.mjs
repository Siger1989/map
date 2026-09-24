import test from 'node:test';
import assert from 'node:assert/strict';
import { routeGap } from '../modules/tracks/routeInfo.ts';
import { RouteGapLayer } from '../modules/tracks/RouteGapLayer.ts';

test('route gap finds the closest real endpoints of disconnected components', () => {
  const gap = routeGap({
    segments: [
      [[100, 20], [100.001, 20]],
      [[100.0013, 20], [100.002, 20]],
      [[101, 21], [101.001, 21]],
    ],
  });
  assert.ok(gap);
  assert.deepEqual(gap.from, [100.001, 20]);
  assert.deepEqual(gap.to, [100.0013, 20]);
  assert.ok(gap.distance > 20 && gap.distance < 40);
});

test('route gap ignores branches that share a stored vertex', () => {
  assert.equal(routeGap({
    segments: [
      [[100, 20], [100.001, 20]],
      [[100.001, 20], [100.001, 20.001]],
    ],
  }), null);
});

test('route gap includes an unfinished one-point segment', () => {
  const gap = routeGap({
    segments: [
      [[100, 20], [100.001, 20]],
      [[100.0012, 20]],
    ],
  });
  assert.ok(gap);
  assert.deepEqual(gap.from, [100.001, 20]);
  assert.deepEqual(gap.to, [100.0012, 20]);
});

test('route gap overlay draws a dashed missing connection and both real endpoints', () => {
  const sources = new Map(), layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    addSource(id) { sources.set(id, { setData(data) { this.data = data; } }); },
    getLayer: (id) => layers.get(id),
    addLayer(layer) { layers.set(layer.id, layer); },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
  };
  const layer = new RouteGapLayer(map);
  layer.sync({ from: [100, 20], to: [100.001, 20], distance: 111 });
  assert.equal(sources.get('route-gap').data.features.length, 3);
  assert.deepEqual(sources.get('route-gap').data.features[0].geometry.coordinates, [[100, 20], [100.001, 20]]);
  assert.deepEqual(layers.get('route-gap-line').paint['line-dasharray'], [1.5, 1.5]);
  layer.sync(null);
  assert.equal(sources.get('route-gap').data.features.length, 0);
});
