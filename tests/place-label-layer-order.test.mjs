import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPlaceLabelLayerOrder } from '../modules/map/overlayData.ts';

class MapFake {
  layers;
  moves = 0;
  constructor(layers) { this.layers = layers.map((id) => ({ id, layout: {} })); }
  getStyle() { return { layers: this.layers }; }
  moveLayer(id, beforeId) {
    this.moves++;
    const from = this.layers.findIndex((layer) => layer.id === id);
    if (from < 0) return;
    const [layer] = this.layers.splice(from, 1);
    const to = beforeId ? this.layers.findIndex((entry) => entry.id === beforeId) : -1;
    this.layers.splice(to < 0 ? this.layers.length : to, 0, layer);
  }
  ids() { return this.layers.map(({ id }) => id); }
  visible(id, value) { this.layers.find((layer) => layer.id === id).layout.visibility = value ? 'visible' : 'none'; }
}

const baseLines = ['road-outline', 'main-roads', 'local-roads'];
const routeLines = ['route-outline', 'route-path', 'route-access', 'manual-track-outline', 'manual-track-line', 'guidance-outline', 'guidance-path', 'guidance-access', 'route-gap-line'];
const topMarks = ['route-points', 'route-point-labels', 'manual-track-endpoint-label', 'manual-track-notes-point', 'guidance-target', 'position-dot'];
const layers = (...groups) => ['background', ...baseLines, ...routeLines, ...groups.flat()];

test('road and route strokes stay below TDT raster labels while endpoint and track text stay above', () => {
  const map = new MapFake(layers(['domestic-labels-map', ...topMarks]));
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  const label = ids.indexOf('domestic-labels-map');
  for (const id of [...baseLines, ...routeLines]) assert.ok(ids.indexOf(id) < label, `${id} is below raster labels`);
  for (const id of topMarks) assert.ok(ids.indexOf(id) > label, `${id} remains above raster labels`);
});

test('vector place labels become the line boundary when raster labels are hidden', () => {
  const map = new MapFake(layers(['domestic-labels-image', 'city-names', 'town-names', ...topMarks]));
  map.visible('domestic-labels-image', false);
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  const city = ids.indexOf('city-names');
  for (const id of [...baseLines, ...routeLines]) assert.ok(ids.indexOf(id) < city, `${id} is below vector labels`);
  for (const id of topMarks) assert.ok(ids.indexOf(id) > city, `${id} remains above vector labels`);
});

test('hidden labels retain the legacy overlay order and repeated sync is stable', () => {
  const map = new MapFake(layers(['domestic-labels-map', 'city-names', ...topMarks]));
  map.visible('domestic-labels-map', false);
  map.visible('city-names', false);
  const baseBefore = map.ids().filter((id) => baseLines.includes(id));
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  assert.deepEqual(ids.filter((id) => baseLines.includes(id)), baseBefore, 'base roads keep their style order');
  assert.ok(ids.indexOf('route-access') < ids.indexOf('route-points'));
  assert.ok(ids.indexOf('route-points') < ids.indexOf('guidance-path'));
  const firstMoveCount = map.moves;
  syncPlaceLabelLayerOrder(map);
  assert.equal(map.moves, firstMoveCount, 'unchanged order performs no map moves');
});

test('visibility changes switch the active boundary without resetting annotation layers', () => {
  const map = new MapFake(layers(['domestic-labels-map', 'city-names', ...topMarks]));
  map.visible('domestic-labels-map', false);
  syncPlaceLabelLayerOrder(map);
  assert.ok(map.ids().indexOf('main-roads') < map.ids().indexOf('city-names'));

  map.visible('domestic-labels-map', true);
  syncPlaceLabelLayerOrder(map);
  assert.ok(map.ids().indexOf('main-roads') < map.ids().indexOf('domestic-labels-map'));
  for (const id of topMarks) assert.ok(map.ids().indexOf(id) > map.ids().indexOf('domestic-labels-map'));

  map.visible('domestic-labels-map', false);
  map.visible('city-names', false);
  syncPlaceLabelLayerOrder(map);
  assert.equal(map.ids().at(-1), 'position-dot');
  map.visible('city-names', true);
  syncPlaceLabelLayerOrder(map);
  assert.ok(map.ids().indexOf('route-path') < map.ids().indexOf('city-names'));
});
