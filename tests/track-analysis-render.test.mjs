import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { metricLineParts } from '../modules/routeAnalysis/metrics.ts';
import { terrainProfileTrack } from '../modules/routeAnalysis/terrainProfileTrack.ts';
import { trackHeights } from '../modules/routeAnalysis/trackElevation.ts';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style.ts';
import { startRouteEdit, selectEditNode, toggleEditBranch, appendEditBranch, undoRouteEdit } from '../modules/tracks/routeEdit.ts';
import { composeTrackOverlay } from '../modules/workbench/trackOverlay.ts';
import { metresBetween } from '../modules/navigation/types.ts';
import { profilePreviewIndex, profilePreviewMoves } from '../modules/tracks/profilePreviewGeometry.ts';

// Bundle the actual layer for Node (its MapLibre constructor uses TS parameter properties).
const result = await build({
  entryPoints: ['modules/tracks/TrackLayer.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { TrackLayer } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);
const diffBuild = await build({
  entryPoints: ['node_modules/maplibre-gl/src/source/geojson_source_diff.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { applySourceDiff, toUpdateable } = await import(
  'data:text/javascript;base64,' + Buffer.from(diffBuild.outputFiles[0].text).toString('base64')
);

test('DEM colours reach the real map source in edit mode; hit targets remain original vertices', () => {
  const sources = new Map(),
    layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    on() {},
    addSource(id, spec) {
      sources.set(id, {
        ...spec,
        setData(data) {
          this.data = data;
        },
        updateData(diff) {
          for (const update of diff.update ?? []) {
            const feature = this.data.features.find((entry) => entry.id === update.id);
            if (!feature) continue;
            if (update.newGeometry) feature.geometry = structuredClone(update.newGeometry);
            for (const { key, value } of update.addOrUpdateProperties ?? [])
              feature.properties[key] = value;
          }
          return Promise.resolve();
        },
      });
    },
    addLayer(spec) {
      layers.set(spec.id, spec);
    },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    isMoving: () => false,
    project: ([x, y]) => ({ x: x * 100000, y: y * 100000 }),
    queryRenderedFeatures: (_, { layers }) =>
      layers.includes('manual-track-line')
        ? [{ properties: { trackId: 'a' } }]
        : [],
  };
  const track = {
    id: 'a',
    name: 'a',
    createdAt: 0,
    segments: [
      [
        [0, 0],
        [0.004, 0],
      ],
    ],
    style: { ...DEFAULT_TRACK_STYLE, colorMode: 'slope' },
  };
  const before = structuredClone(track),
    distance = trackHeights(track)[1].distance;
  const profile = terrainProfileTrack(
    track,
    [500, 501, 520, 560, 500].map((elevation, i) => ({
      coordinates: [0.001 * i, 0],
      distance: (distance * i) / 4,
      part: 0,
      elevation,
    })),
  );
  const state = {
    saved: [track],
    draft: [],
    visible: true,
    style: DEFAULT_TRACK_STYLE,
    nodes: [],
    selectedId: 'a',
    nodeSelection: { trackId: 'a', points: track.segments[0] },
    editing: true,
    analysisParts: { trackId: 'a', parts: metricLineParts(profile, 'slope') },
  };
  const layer = new TrackLayer(map);
  layer.sync(state);
  const data = sources.get('manual-tracks').data;
  const selectedEdges = sources.get('manual-track-selection-edge').data;
  assert.equal(layers.get('manual-track-selection-edge').type, 'line', 'selection uses terrain-draped map lines');
  assert.deepEqual(selectedEdges.features[0].geometry.coordinates, track.segments, 'selection retains geographic geometry, not projected endpoint chords');
  assert.equal(
    new Set(
      data.features
        .filter((f) => f.geometry.type === 'MultiLineString')
        .map((f) => f.properties.color),
    ).size,
    3,
  );
  const nodes = data.features.filter((f) => f.geometry.type === 'Point');
  assert.deepEqual(
    nodes.map((f) => f.geometry.coordinates),
    track.segments[0],
  );
  assert.ok(
    Math.abs(layer.pickLine({ x: 200, y: 0 }).distance - distance / 2) < 0.01,
  );
  assert.deepEqual(track, before);
  const destination = [0.005, 0.001];
  layer.preview({
    node: { trackId: 'a', coordinate: [0.004, 0] },
    coordinate: destination,
  });
  const preview = sources
    .get('manual-tracks')
    .data.features.filter((f) => f.geometry.type === 'MultiLineString');
  assert.ok(
    preview.some((f) =>
      f.geometry.coordinates.some((line) =>
        line.some((c) => c[0] === destination[0] && c[1] === destination[1]),
      ),
    ),
  );
  assert.deepEqual(track, before);
  assert.deepEqual(sources.get('manual-track-selection-edge').data.features[0].geometry.coordinates, [[[0,0],destination]]);
  layer.sync({ ...state, nodeSelection: { trackId: 'a', points: [track.segments[0][0]] } });
  assert.equal(sources.get('manual-track-selection-edge').data.features.length, 0, 'one selected endpoint never highlights an unselected edge');
  layer.sync({ ...state, editing: false });
  assert.equal(sources.get('manual-track-selection-edge').data.features.length, 0, 'leaving edit mode clears highlighting');
});

test('an omitted editing flag keeps the legacy default of drawing route nodes', () => {
  const sources = new Map(), layers = new Map();
  const map = {
    getSource: (id) => sources.get(id), getLayer: (id) => layers.get(id), on() {},
    addSource(id, spec) { sources.set(id, { ...spec, setData(data) { this.data = structuredClone(data); return Promise.resolve(); }, updateData() { return Promise.resolve(); } }); },
    addLayer(spec) { layers.set(spec.id, spec); }, getStyle: () => ({ layers: [...layers.values()] }), moveLayer() {},
    isMoving: () => false, project: ([x, y]) => ({ x: x * 100000, y: y * 100000 }),
  };
  const track = { id: 'default-route', name: 'route', createdAt: 0, segments: [[[0, 0], [0.01, 0]]], style: { ...DEFAULT_TRACK_STYLE } };
  const layer = new TrackLayer(map);
  layer.sync({ saved: [track], draft: [], visible: true, style: DEFAULT_TRACK_STYLE, nodes: [] });
  assert.equal(sources.get('manual-tracks').data.features.filter((feature) => feature.geometry.type === 'Point').length, 2);
});

test('active-node selection patches only changed point features until projection or baseline is invalidated', () => {
  const sources = new Map(),
    layers = new Map(),
    handlers = new Map(),
    counts = { project: 0, setData: 0, mainSetData: 0, updateData: 0 };
  const map = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    addSource(id, spec) {
      const source = {
        ...spec,
        setData(data) {
          counts.setData++;
          if (id === 'manual-tracks') counts.mainSetData++;
          this.data = structuredClone(data);
          return Promise.resolve();
        },
        updateData(diff) {
          counts.updateData++;
          for (const update of diff.update ?? []) {
            const feature = this.data.features.find((entry) => entry.id === update.id);
            if (!feature) continue;
            if (update.newGeometry) feature.geometry = structuredClone(update.newGeometry);
            for (const { key, value } of update.addOrUpdateProperties ?? [])
              feature.properties[key] = value;
          }
          return Promise.resolve();
        },
      };
      sources.set(id, source);
      return source;
    },
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    isMoving: () => false,
    on(type, handler) { handlers.set(type, handler); },
    project: ([x, y]) => {
      counts.project++;
      return { x: x * 100000, y: y * 100000 };
    },
  };
  const track = {
    id: 'a', name: 'a', createdAt: 0,
    segments: [[[0, 0], [0.01, 0], [0.02, 0]]],
    style: { ...DEFAULT_TRACK_STYLE },
  };
  const base = {
    saved: [track], draft: [], visible: true, style: DEFAULT_TRACK_STYLE,
    nodes: [], selectedId: 'a', editing: true, snapTargets: false,
    nodeSelection: { trackId: 'a', points: [track.segments[0][0], track.segments[0][1]] },
    activeNode: { trackId: 'a', coordinate: track.segments[0][0] },
  };
  const layer = new TrackLayer(map);
  layer.sync(base);
  const source = sources.get('manual-tracks');
  const mainSetDataAfterInitial = counts.mainSetData;
  const projectAfterInitial = counts.project;
  layer.sync({ ...base, activeNode: { trackId: 'a', coordinate: track.segments[0][1] } });
  assert.equal(counts.project, projectAfterInitial, 'active-node change reuses the current projected handle set');
  assert.equal(counts.mainSetData, mainSetDataAfterInitial, 'active-node change does not replace the full source');
  assert.equal(counts.updateData, 1, 'active state is patched through one source update');
  const active = source.data.features.filter((feature) => feature.geometry.type === 'Point' && feature.properties.active);
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].geometry.coordinates, track.segments[0][1]);
  assert.deepEqual(sources.get('manual-track-selection-edge').data.features[0].geometry.coordinates, [[track.segments[0][0], track.segments[0][1]]]);

  handlers.get('movestart')();
  const projectBeforeCameraInvalidation = counts.project;
  const setDataBeforeCameraInvalidation = counts.mainSetData;
  layer.sync({ ...base, activeNode: { trackId: 'a', coordinate: track.segments[0][0] } });
  assert.ok(counts.project > projectBeforeCameraInvalidation, 'camera movement forces handle reprojection');
  assert.ok(counts.mainSetData > setDataBeforeCameraInvalidation, 'an imperative property patch invalidates the full-source snapshot even when content returns to an older serialized state');

  const current = { ...base, activeNode: { trackId: 'a', coordinate: track.segments[0][0] } };
  layer.sync(current);
  layer.preview({ node: current.activeNode, coordinate: [0.03, 0.01] });
  const fullSyncsBeforePreviewReset = counts.mainSetData;
  layer.sync({ ...current, activeNode: { trackId: 'a', coordinate: track.segments[0][1] } });
  assert.ok(counts.mainSetData > fullSyncsBeforePreviewReset, 'sync after preview reset rebuilds from the canonical baseline');
  assert.ok(source.data.features.some((feature) => feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates[0].some((point) => point[0] === 0.02 && point[1] === 0)), 'preview geometry is discarded');
  assert.ok(!source.data.features.some((feature) => feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates[0].some((point) => point[0] === 0.03)), 'preview destination does not leak into baseline');
  assert.equal(source.data.features.filter((feature) => feature.geometry.type === 'Point' && feature.properties.active).length, 1);

  const beforeNodeSelectionChange = counts.mainSetData;
  layer.sync({ ...current, activeNode: { trackId: 'a', coordinate: track.segments[0][2] }, nodeSelection: { trackId: 'a', points: [track.segments[0][0]] } });
  assert.equal(counts.mainSetData, beforeNodeSelectionChange, 'node-selection changes update only the separate selection edge source');
  assert.equal(sources.get('manual-track-selection-edge').data.features.length, 0, 'single-node selection clears edge highlights');
  const replacement = map.addSource('manual-tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const beforeReplacementSyncs = counts.mainSetData;
  layer.sync({ ...current, activeNode: { trackId: 'a', coordinate: track.segments[0][2] }, nodeSelection: { trackId: 'a', points: [track.segments[0][0]] } });
  assert.ok(counts.mainSetData > beforeReplacementSyncs, 'recreated source is repopulated through a full sync');
  assert.ok(replacement.data.features.some((feature) => feature.properties.active === true), 'recreated source receives the selected node state');
  layers.delete('manual-track-line');
  const beforeLayerRestore = counts.mainSetData;
  layer.sync({ ...current, activeNode: { trackId: 'a', coordinate: track.segments[0][1] }, nodeSelection: { trackId: 'a', points: [track.segments[0][0]] } });
  assert.ok(counts.mainSetData > beforeLayerRestore, 'missing style layer forces a full sync');
  assert.ok(layers.has('manual-track-line'), 'full sync restores style layers after a style reset');
});

test('elevation-profile samples follow a dragged route endpoint through cancel, commit, box selection, and undo', () => {
  const sources = new Map(), layers = new Map();
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id), on() {},
    addSource(id, spec) {
      sources.set(id, { ...spec,
        setData(data) { this.data = structuredClone(data); return Promise.resolve(); },
        updateData(diff) {
          for (const update of diff.update ?? []) {
            const feature = this.data.features.find(item => item.id === update.id);
            if (!feature) continue;
            if (update.newGeometry) feature.geometry = structuredClone(update.newGeometry);
            for (const { key, value } of update.addOrUpdateProperties ?? []) feature.properties[key] = value;
          }
          return Promise.resolve();
        },
      });
    },
    addLayer(spec) { layers.set(spec.id, spec); }, getStyle: () => ({ layers: [...layers.values()] }), moveLayer() {},
    isMoving: () => false, project: ([x, y]) => ({ x: x * 100000, y: y * 100000 }),
  };
  const a = [0, 0], b = [0.01, 0], c = [0.02, 0];
  const track = { id: 'colored-route', name: 'colored', createdAt: 0, segments: [[a, b, c]], style: { ...DEFAULT_TRACK_STYLE, colorMode: 'elevation', opacity: .45 } };
  const profileFor = current => {
    const first = current.segments[0][0], last = current.segments[0].at(-1);
    const total = metresBetween(first, last);
    return terrainProfileTrack(current, [.0, .125, .25, .375, .5, .625, .75, .875, 1].map((fraction, index) => ({
      coordinates: [first[0] + (last[0] - first[0]) * fraction, 0],
      distance: total * fraction, part: 0, elevation: index * 20,
    })));
  };
  const analysisFor = current => {
    const profile = profileFor(current);
    return { trackId: current.id, parts: metricLineParts(profile, 'elevation'), sourceSegments: current.segments, profileSegments: profile.segments };
  };
  const layer = new TrackLayer(map);
  const base = { saved: [track], draft: [], visible: true, style: track.style, nodes: [], selectedId: track.id, editing: true, nodeSelection: { trackId: track.id, points: [] }, analysisParts: analysisFor(track) };
  const geometry = () => sources.get('manual-tracks').data.features.filter(feature => feature.geometry.type === 'MultiLineString').flatMap(feature => feature.geometry.coordinates).flat();
  const endNode = () => sources.get('manual-tracks').data.features.find(feature => feature.geometry.type === 'Point' && feature.geometry.coordinates[0] === .02);
  const assertNoBeyond = (x, label) => assert.ok(geometry().every(([lng]) => lng <= x + 1e-10), `${label}: no stale elevation sample extends past the moved endpoint`);

  layer.sync(base);
  const canonical = structuredClone(geometry());
  assert.ok(sources.get('manual-tracks').data.features.filter(feature => feature.geometry.type === 'MultiLineString').every(feature => feature.properties.opacity === .45), 'half-opacity route style reaches each colored feature');
  assert.ok(canonical.some(([lng]) => lng > .019), 'fixture contains display-only elevation samples beyond the editable middle vertex');
  layer.preview({ node: { trackId: track.id, coordinate: c }, coordinate: [.018, 0] });
  assertNoBeyond(.018, 'imperative preview');
  assert.ok(sources.get('manual-tracks').data.features.filter(feature => feature.geometry.type === 'MultiLineString').every(feature => feature.properties.opacity === .45), 'imperative geometry updates preserve the half-opacity paint value');
  layer.preview(null);
  assert.deepEqual(geometry(), canonical, 'cancel restores the full colored profile geometry');

  layer.preview({ node: { trackId: track.id, coordinate: c }, coordinate: [.018, 0] });
  const committed = { ...track, segments: [[a, b, [.018, 0]]] };
  const staleAnalysisState = { ...base, saved: [committed] };
  layer.sync(staleAnalysisState);
  assertNoBeyond(.018, 'commit while old profile is still pending');
  const committedState = { ...staleAnalysisState, analysisParts: analysisFor(committed) };
  layer.sync(committedState);
  assertNoBeyond(.018, 'refreshed profile');
  assert.ok(sources.get('manual-track-selection-edge').data.features.length === 0, 'box-add with zero selected nodes has no selected edge');

  const boxed = { ...committedState, nodeSelection: { trackId: track.id, points: [b, [.018, 0]] } };
  layer.sync(boxed);
  assert.ok(sources.get('manual-track-selection-edge').data.features.length > 0, 'adjacent box-selected endpoints highlight their real edge');
  const undone = { ...base, nodeSelection: { trackId: track.id, points: [b, c] } };
  layer.sync(undone);
  assert.deepEqual(geometry(), canonical, 'undo returns both original editable vertices and their original elevation samples');
  assert.ok(sources.get('manual-track-selection-edge').data.features.length > 0, 'box selection after undo uses restored route geometry');
});

test('cached profile preview index keeps 120 dense-route frames bounded to adjacent samples', () => {
  const points = Array.from({ length: 10000 }, (_, index) => [index * .00001, Math.sin(index / 20) * .0001]);
  const track = { id: 'profile-dense', segments: [points], samples: undefined, style: { ...DEFAULT_TRACK_STYLE } };
  const analysis = { trackId: track.id, parts: metricLineParts(track, 'slope'), sourceSegments: track.segments, profileSegments: track.segments };
  const index = profilePreviewIndex(track.segments, track.segments, analysis);
  assert.ok(index);
  assert.ok(index.indexedCoordinates >= points.length, 'index is built once across the complete colored profile');
  const adjacent = index.byNode.get(points[5000].join(','));
  assert.ok(adjacent);
  let visits = 0;
  const originalIterator = adjacent[Symbol.iterator].bind(adjacent);
  adjacent[Symbol.iterator] = function* () { for (const sample of originalIterator()) { visits++; yield sample; } };
  for (let frame = 0; frame < 120; frame++)
    profilePreviewMoves(index, points[5000], [points[5000][0] + frame * .0000001, points[5000][1] + .000001]);
  assert.ok(visits <= adjacent.length * 120, 'each frame visits only the selected node and its incident profile samples');
  assert.ok(visits < points.length, '120 preview frames never rescan all 10000 points');
});

test('real saved-route branch append/join/undo overlays use stable-ID diff and match a full rebuild', () => {
  function createMap() {
    const sources = new Map(), layers = new Map(), handlers = new Map();
    const counts = { mainSetData: 0, mainDiff: 0, added: 0, removed: 0, project: 0 };
    const map = {
      getSource: (id) => sources.get(id), getLayer: (id) => layers.get(id),
      addSource(id, spec) {
        const source = { ...spec,
          setData(data) { if (id === 'manual-tracks') counts.mainSetData++; this.data = structuredClone(data); this.updateable = toUpdateable(this.data); return Promise.resolve(); },
          updateData(diff) {
            if (id === 'manual-tracks') counts.mainDiff++;
            counts.removed += diff.remove?.length ?? 0;
            counts.added += diff.add?.length ?? 0;
            applySourceDiff(this.updateable, diff);
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
    return { map, sources, handlers, counts };
  }
  const incremental = createMap(), full = createMap();
  const original = { id: 'route', name: 'route', createdAt: 0, segments: [[[0, 0], [0.01, 0], [0.02, 0]]], style: { ...DEFAULT_TRACK_STYLE, color: '#c03030' }, nodes: [[0, 0], [0.02, 0]], edgeColors: [['#c03030', '#c03030']], edgeNotes: [[null, '旧边备注']], pointDetails: { '0,0': { note: '起点备注' } } };
  const compose = (session) => composeTrackOverlay({
    saved: [original], draft: [], session, recording: null, visible: true,
    style: original.style, nodes: original.nodes, selectedId: original.id,
    nodeSelection: { trackId: original.id, points: session.selected ? [session.selected] : [] },
  });
  const incrementalLayer = new TrackLayer(incremental.map), fullLayer = new TrackLayer(full.map);
  const canonical = (map) => map.sources.get('manual-tracks').data.features.map((f) => ({ id: f.id, properties: f.properties, geometry: f.geometry })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  let session = selectEditNode(startRouteEdit(original), [0.01, 0]);
  session = toggleEditBranch(session);
  incrementalLayer.sync(compose(session)); fullLayer.sync(compose(session));
  const mainSetsBefore = incremental.counts.mainSetData;
  const syncPair = (nextSession) => {
    session = nextSession;
    incrementalLayer.sync(compose(session));
    full.handlers.get('movestart')();
    fullLayer.sync(compose(session));
    assert.deepEqual(canonical(incremental), canonical(full), 'incremental features match canonical full rebuild');
    assert.deepEqual(incremental.sources.get('manual-track-notes').data, full.sources.get('manual-track-notes').data, 'notes match canonical full rebuild');
  };
  syncPair(appendEditBranch(session, [0.015, 0.006]));
  syncPair(appendEditBranch(session, [0.02, 0]));
  syncPair(undoRouteEdit(session));
  assert.equal(incremental.counts.mainSetData, mainSetsBefore + 2, 'joining ends branch mode and undo restores it, so those state-boundary changes use full rebuilds');
  assert.equal(incremental.counts.mainDiff, 1, 'the real per-step branch extension submits one MapLibre diff');
  assert.ok(incremental.counts.removed > 0 && incremental.counts.added > 0, 'old stable-ID features are removed and replacement features added');
});

test('a stale geometry rejection restores the newest baseline and reapplies the current preview', async () => {
  const sources = new Map(), layers = new Map();
  let rejectGeometry;
  let mainDiffCount = 0;
  const map = {
    getSource: (id) => sources.get(id), getLayer: (id) => layers.get(id), on() {},
    addSource(id, spec) {
      const source = { ...spec,
        setData(data) { this.data = structuredClone(data); this.updateable = toUpdateable(this.data); return Promise.resolve(); },
        updateData(diff) {
          if (id === 'manual-tracks' && mainDiffCount++ === 0 && (diff.remove?.length || diff.add?.length)) {
            return new Promise((resolve, reject) => { rejectGeometry = reject; });
          }
          applySourceDiff(this.updateable, diff);
          this.data = { type: 'FeatureCollection', features: [...this.updateable.values()] };
          return Promise.resolve();
        },
      };
      sources.set(id, source); return source;
    },
    addLayer(spec) { layers.set(spec.id, spec); }, getStyle: () => ({ layers: [...layers.values()] }), moveLayer() {},
    isMoving: () => false, project: ([x, y]) => ({ x: x * 100000, y: y * 100000 }),
  };
  const track = { id: 'async-route', name: 'route', createdAt: 0, segments: [[[0, 0], [0.01, 0], [0.02, 0]]], style: { ...DEFAULT_TRACK_STYLE }, nodes: [[0, 0], [0.01, 0], [0.02, 0]] };
  const base = { saved: [track], draft: [], visible: true, style: DEFAULT_TRACK_STYLE, nodes: [], selectedId: track.id, editing: true, activeNode: { trackId: track.id, coordinate: track.segments[0][0] } };
  const layer = new TrackLayer(map);
  layer.sync(base);
  const edited = { ...track, segments: [[[0, 0], [0.01, 0], [0.02, 0], [0.03, 0]]] };
  const editedState = { ...base, saved: [edited] };
  layer.sync(editedState); // first geometry diff is held and will reject after the active patch
  assert.equal(typeof rejectGeometry, 'function');
  layer.sync({ ...editedState, activeNode: { trackId: track.id, coordinate: track.segments[0][1] } });
  layer.preview({ node: { trackId: track.id, coordinate: track.segments[0][1] }, coordinate: [0.011, 0] });
  const warn = console.warn;
  console.warn = () => {};
  try {
    rejectGeometry(new Error('simulated stale worker failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.warn = warn;
  }
  const current = sources.get('manual-tracks').data.features;
  const line = current.find((feature) => feature.geometry.type === 'MultiLineString');
  assert.ok(line.geometry.coordinates.flat().some(([lng]) => lng === 0.03), 'restore uses the latest edited canonical geometry');
  assert.ok(line.geometry.coordinates.flat().some(([lng]) => lng === 0.011), 'current preview is reapplied after canonical setData');
  const active = current.find((feature) => feature.geometry.type === 'Point' && feature.properties.active);
  assert.deepEqual(active.geometry.coordinates, [0.011, 0], 'restored baseline retains latest active-node state through preview');
});

test('route-handle projection cache reuses unchanged snap candidates and expires on camera/style changes', () => {
  const sources = new Map(), layers = new Map(), handlers = new Map();
  let projectCalls = 0;
  let moving = false;
  const terrain = { source: 'dem' };
  const map = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    addSource(id, spec) {
      sources.set(id, { ...spec, setData(data) { this.data = structuredClone(data); return Promise.resolve(); }, updateData() { return Promise.resolve(); } });
    },
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    on(type, handler) { handlers.set(type, handler); },
    isMoving: () => moving,
    getTerrain: () => terrain,
    project: ([x, y]) => { projectCalls++; return { x: x * 100000, y: y * 100000 }; },
  };
  const makeTrack = (id, size) => ({
    id, name: id, createdAt: 0,
    segments: [[...Array.from({ length: size }, (_, i) => [i * 0.001, id === 'selected' ? 0 : 1])]],
    nodes: [], style: { ...DEFAULT_TRACK_STYLE },
  });
  const selected = makeTrack('selected', 4), candidate = makeTrack('candidate', 4);
  const base = { saved: [selected, candidate], draft: [], visible: true, style: DEFAULT_TRACK_STYLE, nodes: [], selectedId: 'selected', editing: true, snapTargets: true };
  const layer = new TrackLayer(map);
  layer.sync(base);
  const callsAfterInitial = projectCalls;
  const changedSelected = { ...selected, segments: [[...selected.segments[0], [0.004, 0]]] };
  layer.sync({ ...base, saved: [changedSelected, candidate] });
  assert.equal(projectCalls - callsAfterInitial, 4, 'edited route is reprojected while unchanged candidate handle positions are reused');

  handlers.get('movestart')();
  moving = true;
  const beforeMoveSync = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate] });
  assert.equal(projectCalls - beforeMoveSync, 7, 'camera movement expires projections for both tracks');
  moving = false;
  const beforeMoveEndSync = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate], alternativeId: 'after-move' });
  assert.equal(projectCalls - beforeMoveEndSync, 7, 'the first settled-camera sync reprojects all handles before restoring cache validity');

  layers.delete('manual-track-line');
  handlers.get('styledata')();
  const beforeStyleSync = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate] });
  assert.equal(projectCalls - beforeStyleSync, 7, 'style rebuild expires projected handle cache');

  handlers.get('sourcedata')({ sourceId: 'unrelated' });
  const afterUnrelatedSource = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate], alternativeId: 'unrelated-source' });
  assert.equal(projectCalls, afterUnrelatedSource, 'non-terrain source updates preserve projected handles');

  handlers.get('sourcedata')({ sourceId: 'dem' });
  let beforeInvalidation = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate], alternativeId: 'dem-arrived' });
  assert.equal(projectCalls - beforeInvalidation, 7, 'DEM arrival invalidates projection-dependent handle spacing');
  handlers.get('resize')();
  beforeInvalidation = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate], alternativeId: 'resized' });
  assert.equal(projectCalls - beforeInvalidation, 7, 'map resize invalidates projected handle spacing');
  handlers.get('terrain')();
  beforeInvalidation = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate], alternativeId: 'terrain-changed' });
  assert.equal(projectCalls - beforeInvalidation, 7, 'terrain exaggeration/source changes invalidate projected handles');
  handlers.get('webglcontextrestored')();
  beforeInvalidation = projectCalls;
  layer.sync({ ...base, saved: [changedSelected, candidate], alternativeId: 'context-restored' });
  assert.equal(projectCalls - beforeInvalidation, 7, 'WebGL context restoration forces fresh projected handles');
});

test('real route-node selection and overlay composition use the active-node fast path', () => {
  const sources = new Map(), layers = new Map(), handlers = new Map();
  let projectCalls = 0, mainSetData = 0, mainUpdates = 0;
  const map = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    addSource(id, spec) {
      sources.set(id, {
        ...spec,
        setData(data) { if (id === 'manual-tracks') mainSetData++; this.data = structuredClone(data); return Promise.resolve(); },
        updateData(diff) {
          if (id === 'manual-tracks') mainUpdates++;
          for (const update of diff.update ?? []) {
            const feature = this.data.features.find((item) => item.id === update.id);
            if (feature) for (const { key, value } of update.addOrUpdateProperties ?? []) feature.properties[key] = value;
          }
          return Promise.resolve();
        },
      });
    },
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    on(type, handler) { handlers.set(type, handler); },
    isMoving: () => false,
    project: ([x, y]) => { projectCalls++; return { x: x * 100000, y: y * 100000 }; },
  };
  const track = {
    id: 'a', name: 'a', createdAt: 0,
    segments: [[[0, 0], [0.01, 0], [0.02, 0]]],
    nodes: [[0, 0], [0.01, 0], [0.02, 0]],
    style: { ...DEFAULT_TRACK_STYLE },
  };
  const originalSession = { track, original: track, sources: [track], selected: null, branch: null };
  const makeOverlay = (session) => composeTrackOverlay({
    saved: [track], draft: [], session, recording: null,
    visible: true, style: track.style, nodes: track.nodes, selectedId: track.id,
    editing: true, snapTargets: false,
    nodeSelection: { trackId: track.id, points: session.selected ? [session.selected] : [] },
  });
  const layer = new TrackLayer(map);
  layer.sync(makeOverlay(originalSession));
  const first = selectEditNode(originalSession, track.segments[0][0]);
  layer.sync(makeOverlay(first));
  const second = selectEditNode(first, track.segments[0][1]);
  layer.sync(makeOverlay(second));
  assert.equal(mainSetData, 1, 'subsequent real node selections do not replace the whole route source');
  assert.equal(mainUpdates, 2, 'both generated route-node selections patch the active property');
  assert.ok(projectCalls > 0, 'initial layout computes the projected handle set');
  assert.equal(sources.get('manual-tracks').data.features.filter((feature) => feature.properties.active === true).length, 1);
  assert.deepEqual(sources.get('manual-tracks').data.features.find((feature) => feature.properties.active === true).geometry.coordinates, track.segments[0][1]);
});
