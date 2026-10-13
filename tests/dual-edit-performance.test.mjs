import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cameraOverlayRefresh } from '../modules/map/cameraOverlayRefresh.ts';
const bundle = await build({ entryPoints: ['modules/tracks/TrackLayer.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { TrackLayer } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const style = { color: '#ff4400', width: 3 };

test('120 follower camera ends refresh once, direct gestures immediately, teardown cancels', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let runs = 0;
  const refresh = cameraOverlayRefresh(() => runs++);
  for (let i = 0; i < 120; i++) { refresh.request(true); t.mock.timers.tick(16); }
  assert.equal(runs, 0);
  t.mock.timers.tick(100);
  assert.equal(runs, 1);
  refresh.request(true);
  refresh.request(false);
  assert.equal(runs, 2);
  t.mock.timers.tick(100);
  assert.equal(runs, 2);
  refresh.request(true);
  refresh.cancel();
  t.mock.timers.tick(100);
  assert.equal(runs, 2);
});

function createMap() {
  const sources = new Map(), layers = new Map();
  const stats = { vertices: 0, updates: 0, fullWrites: 0 };
  return { stats, sources, layers,
    getSource: id => sources.get(id), getLayer: id => layers.get(id), on() {}, off() {},
    addSource(id, spec) { sources.set(id, { data: structuredClone(spec.data),
      setData(data) { this.data = structuredClone(data); if (id === 'manual-tracks') stats.fullWrites++; return Promise.resolve(); },
      updateData(diff) { for (const update of diff.update ?? []) {
        if (id === 'manual-tracks' && update.newGeometry?.type === 'MultiLineString') {
          stats.vertices += update.newGeometry.coordinates.flat().length; stats.updates++;
        }
        const feature = this.data.features.find(f => f.id === update.id);
        if (feature && update.newGeometry) feature.geometry = structuredClone(update.newGeometry);
      } return Promise.resolve(); },
    }); },
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }), moveLayer() {},
    isMoving: () => false, project: ([x,y]) => ({ x: x * 1e5, y: y * 1e5 }),
  };
}
function browseState(points) {
  const track = { id: 'dense', name: 'dense', createdAt: 0, style, segments: [points], nodes: [] };
  return { saved: [track], draft: [], visible: true, style, nodes: [], selectedId: null, editing: false };
}
function routeFeatures(map) {
  return map.sources.get('manual-tracks').data.features.filter(feature => feature.geometry.type === 'MultiLineString');
}
function routeContainsCoordinate(map, coordinate) {
  return routeFeatures(map).some(feature => feature.geometry.coordinates.some(line =>
    line.some(point => point[0] === coordinate[0] && point[1] === coordinate[1])));
}

test('ordinary browse skips only identical healthy state and lazily indexes public previews', () => {
  const points = Array.from({ length: 1800 }, (_, i) => [20 + i * .00001, 10 + Math.sin(i / 30) * .001]);
  const map = createMap(), layer = new TrackLayer(map), state = browseState(points);
  layer.sync(state);

  const stringify = JSON.stringify;
  let routeSnapshots = 0;
  JSON.stringify = function(value, ...args) {
    if (value?.type === 'FeatureCollection' && value.features?.some(feature =>
      feature.properties?.trackId === 'dense' && feature.geometry.type === 'MultiLineString')) routeSnapshots++;
    return stringify.call(this, value, ...args);
  };
  try {
    layer.sync(state);
    assert.equal(routeSnapshots, 0, 'same browse state does not rebuild or serialize route GeoJSON');
    layer.sync({ ...state });
    assert.equal(routeSnapshots, 1, 'a fresh wrapper performs a real sync');
  } finally { JSON.stringify = stringify; }

  const moved = [points[900][0] + .002, points[900][1] + .002];
  layer.preview({ node: { trackId: 'dense', coordinate: points[900] }, coordinate: moved });
  assert.ok(routeContainsCoordinate(map, moved), 'direct browse preview updates the route');
  assert.ok(map.stats.updates > 0, 'lazy preview index finds affected route features');
  layer.preview(null);
  assert.ok(routeContainsCoordinate(map, points[900]), 'cancel restores canonical route coordinates');

  const changedPoint = [points[900][0] + .004, points[900][1] + .003];
  const changedPoints = points.map((point, index) => index === 900 ? changedPoint : point);
  const changedState = { ...state, saved: [{ ...state.saved[0], segments: [changedPoints] }] };
  layer.sync(changedState);
  assert.ok(routeContainsCoordinate(map, changedPoint), 'immutable geometry change is fully resynchronized');

  const oldWrites = map.stats.fullWrites;
  map.sources.delete('manual-tracks');
  layer.sync(state);
  assert.ok(map.sources.has('manual-tracks'), 'replaced source is recreated');
  assert.ok(map.stats.fullWrites > oldWrites, 'source recovery performs a full data write');
  map.layers.delete('manual-track-line');
  layer.sync(state);
  assert.ok(map.layers.has('manual-track-line'), 'deleted route layer is recreated');
});

test('entering edit mode after browsing builds node indexes before preview', () => {
  const points = Array.from({ length: 900 }, (_, i) => [20 + i * .00001, 10 + Math.sin(i / 30) * .001]);
  const map = createMap(), layer = new TrackLayer(map), browse = browseState(points);
  layer.sync(browse);
  const editing = { ...browse, editing: true, selectedId: 'dense' };
  layer.sync(editing);
  const moved = [points[450][0] + .001, points[450][1] + .001];
  layer.preview({ node: { trackId: 'dense', coordinate: points[450] }, coordinate: moved });
  assert.ok(routeContainsCoordinate(map, moved), 'edit-mode preview moves the requested node');
  layer.preview(null);
  assert.ok(routeContainsCoordinate(map, points[450]));
});

test('unchanged browse restores replaced auxiliary sources and selected-edge layers', () => {
  const points = Array.from({ length: 80 }, (_, i) => [20 + i * .0001, 10 + Math.sin(i / 8) * .001]);
  const base = browseState(points), annotatedTrack = {
    ...base.saved[0], pointDetails: { [points[10].join(',')]: { note: 'Synthetic note' } },
  };
  const state = { ...base, saved: [annotatedTrack],
    analysisMarkers: [{ coordinate: points[20], label: 'Synthetic warning' }],
    linePoint: { trackId: 'dense', coordinate: points[30] },
  };
  const map = createMap(), layer = new TrackLayer(map);
  layer.sync(state);
  const expectedCounts = new Map([
    ['manual-track-notes', 1], ['route-grade-warnings', 1], ['track-line-selection', 1],
  ]);

  for (const [id, expectedCount] of expectedCounts) {
    map.sources.delete(id);
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    layer.sync(state);
    assert.equal(map.sources.get(id).data.features.length, expectedCount, `${id} replacement receives current browse data`);
  }

  map.layers.delete('manual-track-selection-edge');
  layer.sync(state);
  assert.ok(map.layers.has('manual-track-selection-edge'), 'deleted selected-edge layer is recreated');
  map.layers.delete('track-line-selection-halo');
  layer.sync(state);
  assert.ok(map.layers.has('track-line-selection-halo'), 'deleted selection halo layer is recreated');
});

test('dual dense-route drag bounds worker payload and preserves every edge and cancel geometry', () => {
  const points = Array.from({length: 10000}, (_, i) => [20 + i * .00001, 10 + Math.sin(i / 30) * .001]);
  const track = { id: 'dense', name: 'dense', createdAt: 0, style, segments: [points], nodes: [] };
  const maps = [createMap(), createMap()], layers = maps.map(map => new TrackLayer(map));
  const state = { saved: [track], draft: [], visible: true, style, nodes: [], selectedId: 'dense', editing: true };
  layers.forEach(layer => layer.sync(state));
  const geometry = map => map.sources.get('manual-tracks').data.features.filter(f => f.geometry.type === 'MultiLineString').flatMap(f => f.geometry.coordinates);
  const edges = lines => lines.flatMap(line => line.slice(1).map((point, i) => [line[i], point]));
  maps.forEach(map => assert.deepEqual(edges(geometry(map)), edges([points])));
  const baseline = maps.map(map => structuredClone(geometry(map)));
  for (let frame = 0; frame < 120; frame++) layers.forEach(layer => layer.preview({ node: { trackId: 'dense', coordinate: points[5000] }, coordinate: [20.05, 10 + frame * .000001] }));
  assert.equal(maps[0].stats.vertices, 120 * 128);
  assert.equal(maps[1].stats.vertices, 120 * 128);
  // A chunk boundary updates both adjoining pieces, keeping the connecting edge.
  layers.forEach(layer => { layer.preview(null); layer.preview({ node: { trackId: 'dense', coordinate: points[127] }, coordinate: [20.01, 10.1] }); layer.preview(null); });
  maps.forEach((map, i) => { assert.deepEqual(geometry(map), baseline[i]); assert.equal(map.stats.fullWrites, 1); });
  assert.deepEqual(track.segments, [points], 'render previews never mutate saved coordinates');
  const transparent = createMap();
  new TrackLayer(transparent).sync({ ...state, saved: [{ ...track, style: { ...style, opacity: .5 } }] });
  const translucentLines = geometry(transparent);
  assert.equal(translucentLines.length, 1, 'translucent round caps keep one feature to avoid dark overlapping joints');
  assert.deepEqual(translucentLines[0], points);
});
