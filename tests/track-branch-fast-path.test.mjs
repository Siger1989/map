import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style.ts';
import { startRouteEdit, selectEditNode, toggleEditBranch, appendEditBranch, undoRouteEdit } from '../modules/tracks/routeEdit.ts';
import { composeTrackOverlay } from '../modules/workbench/trackOverlay.ts';

const bundled = await build({ entryPoints: ['modules/tracks/TrackLayer.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { TrackLayer } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const diffBundle = await build({ entryPoints: ['node_modules/maplibre-gl/src/source/geojson_source_diff.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { toUpdateable, applySourceDiff } = await import('data:text/javascript;base64,' + Buffer.from(diffBundle.outputFiles[0].text).toString('base64'));

function harness({ rejectNextDiff = false, deferNextDiff = false } = {}) {
  const sources = new Map(), layers = new Map(), handlers = new Map();
  const counts = { setData: 0, diff: 0, project: 0, lineBuilds: 0, lineRemovals: 0 };
  let rejectDiff = rejectNextDiff;
  let deferDiff = deferNextDiff, rejectDeferredDiff = null;
  const map = {
    getSource: (id) => sources.get(id), getLayer: (id) => layers.get(id),
    addSource(id, spec) {
      const source = { ...spec,
        setData(data) { if (id === 'manual-tracks') counts.setData++; this.data = structuredClone(data); this.updateable = toUpdateable(this.data); return Promise.resolve(); },
        updateData(diff) {
          if (id !== 'manual-tracks') return Promise.resolve();
          counts.diff++;
          if (rejectDiff) { rejectDiff = false; return Promise.reject(new Error('simulated worker failure')); }
          if (deferDiff) {
            deferDiff = false;
            return new Promise((resolve, reject) => { rejectDeferredDiff = reject; });
          }
          counts.lineBuilds += (diff.add ?? []).filter((feature) => feature.geometry.type !== 'Point').length;
          counts.lineRemovals += (diff.remove ?? []).filter((featureId) => this.updateable.get(featureId)?.geometry.type !== 'Point').length;
          const before = new Map(this.updateable);
          applySourceDiff(this.updateable, diff);
          for (const [featureId, feature] of this.updateable) {
            if (before.get(featureId) !== feature && feature.geometry.type !== 'Point') counts.lineBuilds++;
          }
          this.data = { type: 'FeatureCollection', features: [...this.updateable.values()] };
          return Promise.resolve();
        },
      };
      sources.set(id, source); return source;
    },
    addLayer(spec) { layers.set(spec.id, spec); }, getStyle: () => ({ layers: [...layers.values()] }), moveLayer() {},
    on(type, handler) { handlers.set(type, handler); }, isMoving: () => false,
    project: ([x, y]) => { counts.project++; return { x: x * 100000, y: y * 100000 }; },
  };
  return { map, sources, layers, handlers, counts, rejectDeferredDiff: () => rejectDeferredDiff?.(new Error('simulated delayed worker failure')) };
}

const makeTrack = (id, offset = 0) => ({
  id, name: id, createdAt: 0,
  segments: [[...Array.from({ length: 18 }, (_, i) => [offset + i * 0.001, offset])]],
  nodes: [[offset, offset], [offset + 0.017, offset]], style: { ...DEFAULT_TRACK_STYLE },
});
const baseline = () => ({
  saved: [makeTrack('selected'), makeTrack('background', 1), { ...makeTrack('recorded', 2), source: 'recorded', samples: [[2, 2], [2.017, 2]] }], draft: [], visible: true,
  style: DEFAULT_TRACK_STYLE, nodes: [], selectedId: 'selected', editing: true,
  connecting: false, snapTargets: false,
});
const main = (h) => h.sources.get('manual-tracks');
const lines = (h) => main(h).data.features.filter((f) => f.geometry.type !== 'Point');
const sortedGeometry = (features) => features.map((f) => [f.id, f.geometry]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
const geometryRefs = (features) => new Map(features.map((f) => [f.id, f.geometry]));
function assertSameLineReferences(before, after) {
  const afterById = new Map(after.map((feature) => [feature.id, feature]));
  for (const [id, geometry] of before) assert.equal(afterById.get(id)?.geometry, geometry, `line ${id} retained its geometry object`);
}
const canonical = (h) => main(h).data.features.map((f) => ({ id: f.id, properties: f.properties, geometry: f.geometry })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
function assertMatchesFull(state, incremental) {
  const rebuilt = harness(), fullLayer = new TrackLayer(rebuilt.map);
  fullLayer.sync(state);
  assert.deepEqual(canonical(incremental), canonical(rebuilt), 'incremental feature collection matches fresh full render including IDs');
}

test('ordinary active-node updates remain incremental, while empty branch open/close patches handles only', () => {
  const h = harness(), layer = new TrackLayer(h.map), initial = baseline();
  layer.sync(initial);
  const initialSet = h.counts.setData;
  const lineBaseline = sortedGeometry(lines(h));
  const lineGeometryRefs = geometryRefs(lines(h));
  layer.sync({ ...initial, activeNode: { trackId: 'selected', coordinate: [0.001, 0] } });
  assert.equal(h.counts.setData, initialSet);
  const afterOrdinaryDiffs = h.counts.diff;
  const afterOrdinaryProjects = h.counts.project;

  const opened = { ...initial, connecting: true };
  layer.sync(opened);
  assert.equal(h.counts.setData, initialSet, 'opening an empty branch avoids full source setData');
  assert.equal(h.counts.diff, afterOrdinaryDiffs + 1);
  assert.ok(h.counts.project > afterOrdinaryProjects, 'newly visible handles are projected');
  assert.deepEqual(sortedGeometry(lines(h)), lineBaseline, 'all background and selected line IDs/geometries remain unchanged');
  assertSameLineReferences(lineGeometryRefs, lines(h));
  assert.ok(main(h).data.features.some((f) => f.geometry.type === 'Point' && f.properties.trackId === 'background'));
  assert.ok(main(h).data.features.some((f) => f.geometry.type === 'Point' && f.properties.trackId === 'recorded'), 'connecting mode also exposes recorded-track handles');
  assertMatchesFull(opened, h);

  const projectsAfterOpen = h.counts.project;
  layer.sync({ ...initial, connecting: false });
  assert.equal(h.counts.setData, initialSet, 'closing branch mode also avoids setData');
  assert.deepEqual(sortedGeometry(lines(h)), lineBaseline);
  assertSameLineReferences(lineGeometryRefs, lines(h));
  assert.ok(h.counts.project >= projectsAfterOpen);
  assert.equal(h.counts.lineBuilds, 0, 'branch transitions never replace line features');
  assert.equal(h.counts.lineRemovals, 0, 'branch transitions never remove line features');
  assertMatchesFull(initial, h);
});

test('newly drawn draft geometry explicitly takes the canonical sync path', () => {
  const h = harness(), layer = new TrackLayer(h.map), initial = baseline();
  layer.sync(initial);
  const sets = h.counts.setData;
  const withDraft = { ...initial, connecting: true, draft: [[[0, 0], [0.003, 0.002]]] };
  layer.sync(withDraft);
  assert.ok(h.counts.setData > sets, 'draft geometry changes use the canonical full sync');
  assert.ok(lines(h).some((feature) => feature.properties.trackId === 'draft'));
  assertMatchesFull(withDraft, h);
});

test('real routeEdit and compose states open/end an empty branch by updating handles only', () => {
  const h = harness(), layer = new TrackLayer(h.map);
  const route = { ...makeTrack('selected'), edgeColors: [['#228866']], edgeNotes: [[null]] };
  const background = makeTrack('background', 1);
  const display = { saved: [route, background], draft: [], recording: null, visible: true, style: route.style, nodes: route.nodes, selectedId: route.id, snapTargets: true };
  let session = selectEditNode(startRouteEdit(route), route.segments[0][2]);
  const overlay = (current) => composeTrackOverlay({ ...display, session: current, nodeSelection: { trackId: route.id, points: current?.selected ? [current.selected] : [] } });
  layer.sync(overlay(session));
  const setCount = h.counts.setData;
  const diffCount = h.counts.diff;
  session = toggleEditBranch(session);
  layer.sync(overlay(session));
  assert.equal(h.counts.setData, setCount, 'actual compose output keeps empty-branch start incremental');
  assert.equal(h.counts.diff, diffCount, 'no main-source worker diff is sent when visible handles already match');
  assertMatchesFull(overlay(session), h);
  session = toggleEditBranch(session);
  layer.sync(overlay(session));
  assert.equal(h.counts.setData, setCount, 'actual compose output keeps empty-branch cancel incremental');
  assert.equal(h.counts.diff, diffCount, 'empty branch cancel also skips an empty worker diff');
  assertMatchesFull(overlay(session), h);

  session = toggleEditBranch(session);
  session = appendEditBranch(session, [0.005, 0.003]);
  layer.sync(overlay(session));
  const setsAfterAppend = h.counts.setData;
  const mainDiffsBeforeEnd = h.counts.diff;
  session = toggleEditBranch(session);
  layer.sync(overlay(session));
  assert.equal(h.counts.setData, setsAfterAppend, 'ending a completed branch leaves main source incremental');
  assert.equal(h.counts.diff, mainDiffsBeforeEnd, 'ending does not send an empty worker diff when snap-target handles remain visible');
  assertMatchesFull(overlay(session), h);

  session = undoRouteEdit(session);
  layer.sync(overlay(session));
  assertMatchesFull(overlay(session), h);
});

test('real empty-branch open/close preserves recorded and sampled background handle semantics with snap targets enabled', () => {
  const h = harness(), layer = new TrackLayer(h.map);
  const route = makeTrack('selected');
  const manual = makeTrack('manual-background', 1);
  const recorded = { ...makeTrack('recorded-background', 2), source: 'recorded' };
  const sampled = { ...makeTrack('sampled-background', 3), samples: [[3, 3], [3.017, 3]] };
  const display = { saved: [route, manual, recorded, sampled], draft: [], recording: null, visible: true, style: route.style, nodes: route.nodes, selectedId: route.id, snapTargets: true };
  let session = selectEditNode(startRouteEdit(route), route.segments[0][2]);
  const overlay = (current) => composeTrackOverlay({ ...display, session: current, nodeSelection: { trackId: route.id, points: current?.selected ? [current.selected] : [] } });
  layer.sync(overlay(session));
  const setCount = h.counts.setData;

  session = toggleEditBranch(session);
  layer.sync(overlay(session));
  for (const id of ['recorded-background', 'sampled-background']) {
    assert.ok(main(h).data.features.some((feature) => feature.geometry.type === 'Point' && feature.properties.trackId === id), `${id} exposes handles while connecting`);
  }
  assertMatchesFull(overlay(session), h);

  session = toggleEditBranch(session);
  layer.sync(overlay(session));
  for (const id of ['recorded-background', 'sampled-background']) {
    assert.ok(!main(h).data.features.some((feature) => feature.geometry.type === 'Point' && feature.properties.trackId === id), `${id} is excluded again when snap targets resume`);
  }
  assert.equal(h.counts.setData, setCount, 'both transitions use handle-only diffs');
  assertMatchesFull(overlay(session), h);
});

test('a delayed early branch diff failure restores the state after a later close toggle', async () => {
  const h = harness({ deferNextDiff: true }), layer = new TrackLayer(h.map);
  const route = makeTrack('selected');
  const recorded = { ...makeTrack('recorded-background', 2), source: 'recorded' };
  const sampled = { ...makeTrack('sampled-background', 3), samples: [[3, 3], [3.017, 3]] };
  const display = { saved: [route, recorded, sampled], draft: [], recording: null, visible: true, style: route.style, nodes: route.nodes, selectedId: route.id, snapTargets: true };
  let session = selectEditNode(startRouteEdit(route), route.segments[0][2]);
  const overlay = (current) => composeTrackOverlay({ ...display, session: current, nodeSelection: { trackId: route.id, points: current?.selected ? [current.selected] : [] } });
  layer.sync(overlay(session));
  const setsBefore = h.counts.setData;

  session = toggleEditBranch(session);
  const opened = overlay(session);
  layer.sync(opened); // hold this add-node diff until after the close operation
  session = toggleEditBranch(session);
  const closed = overlay(session);
  layer.sync(closed);
  h.rejectDeferredDiff();
  const warn = console.warn; console.warn = () => {};
  try { await new Promise((resolve) => setTimeout(resolve, 0)); }
  finally { console.warn = warn; }

  assert.ok(h.counts.setData > setsBefore, 'late failed diff restores the current canonical baseline');
  for (const id of ['recorded-background', 'sampled-background']) {
    assert.ok(!main(h).data.features.some((feature) => feature.geometry.type === 'Point' && feature.properties.trackId === id), `restored state does not retain stale ${id} handles`);
  }
  assertMatchesFull(closed, h);
});

test('snap-target changes update eligible background handles without rebuilding their line geometry', () => {
  const h = harness(), layer = new TrackLayer(h.map), initial = baseline();
  layer.sync(initial);
  const sets = h.counts.setData, lineBaseline = sortedGeometry(lines(h));
  layer.sync({ ...initial, snapTargets: true, movableTrackId: 'background' });
  assert.equal(h.counts.setData, sets);
  assert.ok(main(h).data.features.filter((f) => f.geometry.type === 'Point' && f.properties.trackId === 'background').length >= 2);
  assert.deepEqual(sortedGeometry(lines(h)), lineBaseline);
  layer.sync({ ...initial, snapTargets: false, movableTrackId: null });
  assert.equal(h.counts.setData, sets);
  assert.deepEqual(sortedGeometry(lines(h)), lineBaseline);
  assert.equal(h.counts.lineBuilds, 0);
});

test('camera, style-layer and source replacement invalidate the fast path and recover with full sync', () => {
  const h = harness(), layer = new TrackLayer(h.map), initial = baseline();
  layer.sync(initial);
  let sets = h.counts.setData;
  h.layers.delete('manual-track-line');
  h.handlers.get('styledata')();
  layer.sync({ ...initial, connecting: true });
  assert.ok(h.counts.setData > sets, 'missing layer falls back to canonical full sync');
  assert.ok(h.layers.has('manual-track-line'));

  sets = h.counts.setData;
  h.handlers.get('movestart')();
  layer.sync({ ...initial, connecting: false });
  assert.ok(h.counts.setData > sets, 'camera movement expires projected spacing and falls back to full sync');

  const previousSource = main(h);
  const replacement = { ...previousSource, setData: previousSource.setData, updateData: previousSource.updateData };
  h.sources.set('manual-tracks', replacement);
  h.handlers.get('styledata')();
  sets = h.counts.setData;
  layer.sync({ ...initial, connecting: false });
  assert.ok(h.counts.setData > sets, 'replaced source cannot use stale baseline indexes');
  assert.ok(replacement.data.features.length > 0);
});

test('failed asynchronous handle diff restores the newest canonical baseline', async () => {
  const h = harness({ rejectNextDiff: true }), layer = new TrackLayer(h.map), initial = baseline();
  layer.sync(initial);
  const warn = console.warn; console.warn = () => {};
  const expected = { ...initial, connecting: true };
  try {
    layer.sync(expected);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally { console.warn = warn; }
  assert.ok(h.counts.setData >= 2, 'rejected async diff triggers canonical recovery');
  assert.ok(main(h).data.features.some((f) => f.geometry.type === 'Point' && f.properties.trackId === 'background'));
  assertMatchesFull(expected, h);
});
