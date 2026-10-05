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
  return { stats, sources,
    getSource: id => sources.get(id), getLayer: id => layers.get(id), on() {},
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
