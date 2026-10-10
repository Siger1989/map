import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPlaceLabelLayerOrder } from '../modules/map/overlayData.ts';

class MapFake {
  layers;
  moves = 0;
  constructor(layers) {
    this.layers = layers.map((id) => ({
      id,
      type: ['track-line-selection-halo', 'track-line-selection'].includes(id) ? 'circle' : routeLines.includes(id) ? 'line' : 'symbol',
      layout: {},
    }));
  }
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

class EventMapFake extends MapFake {
  events = new Map();
  emitMoveEvents = false;
  on(name, listener) { const listeners = this.events.get(name) ?? new Set(); listeners.add(listener); this.events.set(name, listeners); return this; }
  off(name, listener) { this.events.get(name)?.delete(listener); return this; }
  emit(name) { for (const listener of [...(this.events.get(name) ?? [])]) listener(); }
  listenerCount(name) { return this.events.get(name)?.size ?? 0; }
  moveLayer(id, beforeId) { super.moveLayer(id, beforeId); if (this.emitMoveEvents) this.emit('styledata'); }
  addLayer(id, type) { this.layers.push({ id, type, layout: {} }); this.emit('styledata'); }
  remove() { this.emit('remove'); }
}

const baseLines = ['road-outline', 'main-roads', 'local-roads'];
const routeLines = ['route-outline', 'route-path', 'route-access', 'manual-track-outline', 'manual-track-selection-edge', 'manual-track-line', 'guidance-outline', 'guidance-path', 'guidance-access', 'route-gap-line'];
const topMarks = ['route-points', 'route-point-labels', 'route-gap-points', 'manual-track-node', 'manual-track-selected-node', 'manual-track-endpoint-label', 'manual-track-notes-point', 'guidance-target', 'route-grade-warning-dot', 'route-grade-warning-label', 'track-line-selection-halo', 'track-line-selection', 'position-dot', 'position-arrow', 'cad-labels'];
const otherNativeIcons = ['cad-point', 'model-terrain-contact'];
const layers = (...groups) => ['background', ...baseLines, ...routeLines, ...groups.flat()];

test('roads stay below raster labels; route strokes form the final tier above labels and native icons', () => {
  const map = new MapFake(layers(['domestic-labels-map', ...topMarks, ...otherNativeIcons]));
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  const label = ids.indexOf('domestic-labels-map');
  for (const id of baseLines) assert.ok(ids.indexOf(id) < label, `${id} is below raster labels`);
  for (const id of topMarks) assert.ok(ids.indexOf(id) > label, `${id} remains above raster labels`);
  for (const id of routeLines) assert.ok(ids.indexOf(id) > label, `${id} is above raster labels`);
  for (const id of otherNativeIcons) assert.ok(ids.indexOf(id) < ids.indexOf('route-outline'), `${id} remains below route strokes`);
  for (const id of ['track-line-selection-halo', 'track-line-selection'])
    assert.ok(ids.indexOf(id) < ids.indexOf('route-outline'), `${id} circle remains below route strokes`);
  assert.deepEqual(ids.slice(-routeLines.length), routeLines, 'route strokes are the final stable GL tier');
});

test('a future route-tier id with a non-line type is not promoted above icons', () => {
  const map = new MapFake(layers(['route-points', 'domestic-labels-map']));
  map.layers.find((layer) => layer.id === 'route-path').type = 'circle';
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  assert.ok(ids.indexOf('route-path') < ids.indexOf('route-points'));
  assert.deepEqual(ids.slice(-routeLines.length + 1), routeLines.filter((id) => id !== 'route-path'));
});

test('vector place labels become the line boundary when raster labels are hidden', () => {
  const map = new MapFake(layers(['domestic-labels-image', 'city-names', 'town-names', ...topMarks, ...otherNativeIcons]));
  map.visible('domestic-labels-image', false);
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  const city = ids.indexOf('city-names');
  for (const id of baseLines) assert.ok(ids.indexOf(id) < city, `${id} is below vector labels`);
  for (const id of topMarks) assert.ok(ids.indexOf(id) > city, `${id} remains above vector labels`);
  for (const id of routeLines) assert.ok(ids.indexOf(id) > city, `${id} is above vector labels`);
  for (const id of otherNativeIcons) assert.ok(ids.indexOf(id) < ids.indexOf('route-outline'), `${id} remains below route strokes`);
  assert.deepEqual(ids.slice(-routeLines.length), routeLines);
});

test('hidden labels retain the legacy overlay order and repeated sync is stable', () => {
  const map = new MapFake(layers(['domestic-labels-map', 'city-names', ...topMarks, ...otherNativeIcons]));
  map.visible('domestic-labels-map', false);
  map.visible('city-names', false);
  const baseBefore = map.ids().filter((id) => baseLines.includes(id));
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  assert.deepEqual(ids.filter((id) => baseLines.includes(id)), baseBefore, 'base roads keep their style order');
  assert.ok(ids.indexOf('route-points') < ids.indexOf('route-access'));
  assert.ok(ids.indexOf('guidance-target') < ids.indexOf('guidance-path'));
  assert.deepEqual(ids.slice(-routeLines.length), routeLines);
  const firstMoveCount = map.moves;
  syncPlaceLabelLayerOrder(map);
  assert.equal(map.moves, firstMoveCount, 'unchanged order performs no map moves');
});

test('late native icon layers are kept below the route tier on the next sync', () => {
  const map = new MapFake(layers(['domestic-labels-map', ...topMarks]));
  syncPlaceLabelLayerOrder(map);
  map.layers.push({ id: 'late-native-icon', layout: {} });
  syncPlaceLabelLayerOrder(map);
  const ids = map.ids();
  assert.ok(ids.indexOf('late-native-icon') < ids.indexOf('route-outline'));
  assert.deepEqual(ids.slice(-routeLines.length), routeLines);
  const moves = map.moves;
  syncPlaceLabelLayerOrder(map);
  assert.equal(map.moves, moves, 'late-layer correction is idempotent');
});

test('styledata guard reorders late layers without a source sync and unbinds on map removal', () => {
  const map = new EventMapFake(layers(['domestic-labels-map', ...topMarks]));
  syncPlaceLabelLayerOrder(map);
  assert.equal(map.listenerCount('styledata'), 1);
  assert.equal(map.listenerCount('remove'), 1);

  map.layers.push({ id: 'late-circle', type: 'circle', layout: {} });
  map.layers.push({ id: 'late-custom', type: 'custom', layout: {} });
  map.emitMoveEvents = true;
  const beforeEvent = map.moves;
  map.emit('styledata');
  const afterFirstEvent = map.moves;
  assert.ok(afterFirstEvent > beforeEvent, 'styledata event reorders routes without GeoJSON sync');
  assert.deepEqual(map.ids().slice(-routeLines.length), routeLines);
  map.emit('styledata');
  assert.equal(map.moves, afterFirstEvent, 'repeated styledata is idempotent');

  map.remove();
  assert.equal(map.listenerCount('styledata'), 0);
  assert.equal(map.listenerCount('remove'), 0);
  const afterRemove = map.moves;
  map.addLayer('post-remove-layer', 'circle');
  assert.equal(map.moves, afterRemove, 'removed map has no route tier listener');
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
  assert.deepEqual(map.ids().slice(-routeLines.length), routeLines);
  map.visible('city-names', true);
  syncPlaceLabelLayerOrder(map);
  assert.ok(map.ids().indexOf('route-path') > map.ids().indexOf('city-names'));
  assert.deepEqual(map.ids().slice(-routeLines.length), routeLines);
});
