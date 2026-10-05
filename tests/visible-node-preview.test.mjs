import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style.ts';
import { startRouteEdit, moveEditNode, undoRouteEdit } from '../modules/tracks/routeEdit.ts';
import { applyTrackVisibleNodeMove, moves } from '../modules/tracks/visibleNodeMove.ts';

const layerBundle = await build({ stdin: { contents: "export { TrackLayer } from './modules/tracks/TrackLayer.ts'; export { CameraSync } from './modules/map/cameraSync.ts'; export { cameraDetailZoom } from './modules/map/cameraDetailZoom.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { TrackLayer, CameraSync, cameraDetailZoom } = await import('data:text/javascript;base64,' + Buffer.from(layerBundle.outputFiles[0].text).toString('base64'));
const diffBundle = await build({ entryPoints: ['node_modules/maplibre-gl/src/source/geojson_source_diff.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { toUpdateable, applySourceDiff } = await import('data:text/javascript;base64,' + Buffer.from(diffBundle.outputFiles[0].text).toString('base64'));

const clone = value => structuredClone(value);
const key = point => point.join(',');
const chunks = line => {
  const result = [];
  for (let start = 0; start < line.length - 1; start += 127) result.push(line.slice(start, start + 128));
  return result;
};

function createMap(projectionScale, cameraAware = false, hitCoordinate = route.nodes[1]) {
  const sources = new Map(), layers = new Map(), handlers = new Map(), counts = { project: 0, updateData: 0 };
  const camera = { lng: 0.02, lat: 0, zoom: 10, pitch: 0, bearing: 0, width: 400, height: 400 };
  const map = {
    getSource: id => sources.get(id),
    getLayer: id => layers.get(id),
    getStyle: () => ({ layers: [...layers.values()] }),
    isMoving: () => false,
    getTerrain: () => ({ source: 'terrain-dem' }),
    on(type, callback) { handlers.set(type, callback); },
    addLayer(spec) { layers.set(spec.id, spec); },
    moveLayer() {},
    ...(cameraAware ? {
      getCenter: () => ({ lng: camera.lng, lat: camera.lat }),
      getZoom: () => camera.zoom,
      getPitch: () => camera.pitch,
      getBearing: () => camera.bearing,
      getCanvas: () => ({ clientWidth: camera.width, clientHeight: camera.height, width: camera.width, height: camera.height }),
    } : {}),
    project([lng, lat]) {
      counts.project++;
      const scale = projectionScale * (cameraAware ? 2 ** (camera.zoom - 10) : 1);
      return cameraAware
        ? { x: (lng - camera.lng) * scale + camera.width / 2, y: (lat - camera.lat) * scale + camera.height / 2 }
        : { x: lng * scale, y: lat * scale };
    },
    queryRenderedFeatures(_box, options) {
      if (!options?.layers?.includes('manual-track-node')) return [];
      const source = sources.get('manual-tracks');
      return (source?.data.features ?? []).filter(feature => feature.geometry.type === 'Point' && feature.properties.trackId === 'edit-route' && feature.properties.nodeLng === hitCoordinate[0] && feature.properties.nodeLat === hitCoordinate[1]);
    },
    addSource(id, spec) {
      const source = {
        ...spec,
        setData(data) {
          this.data = clone(data);
          this.updateable = toUpdateable(this.data);
          return Promise.resolve();
        },
        updateData(diff) {
          counts.updateData++;
          applySourceDiff(this.updateable, diff);
          this.data = { type: 'FeatureCollection', features: [...this.updateable.values()] };
          return Promise.resolve();
        },
      };
      sources.set(id, source);
      if (spec.data) source.setData(spec.data);
      return source;
    },
  };
  return { map, sources, layers, counts, camera, handlers };
}

const allPoints = Array.from({ length: 400 }, (_, index) => [index * 0.0001, Math.sin(index / 9) * 0.00012]);
const a = allPoints[160], b = allPoints[180], c = allPoints[200];
const route = {
  id: 'edit-route', name: 'edit-route', source: 'manual', createdAt: 1,
  segments: [allPoints], nodes: [a, b, c], style: { ...DEFAULT_TRACK_STYLE },
};
const background = { id: 'background', name: 'background', createdAt: 1, segments: [[[0.01, 0.001], [0.011, 0.001], [0.012, 0.001]]], nodes: [], style: { ...DEFAULT_TRACK_STYLE } };
const viewport = () => ({ west: -0.001, east: 0.05, south: -0.002, north: 0.002, width: 400, height: 400, revision: 'view' });
const overlay = session => ({
  saved: [session.track, background], draft: [], visible: true, style: session.track.style, nodes: session.track.nodes,
  selectedId: session.track.id, editing: true, activeNode: { trackId: session.track.id, coordinate: session.track.nodes?.[1] ?? b },
  nodeSelection: { trackId: session.track.id, points: [a, b] },
});
const lineFeatures = source => source.data.features.filter(feature => feature.geometry.type === 'MultiLineString');
const featureOrder = (left, right) => String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
const routeLines = source => lineFeatures(source).filter(feature => feature.properties.trackId === route.id).sort(featureOrder);
const backgroundLines = source => lineFeatures(source).filter(feature => feature.properties.trackId === background.id).sort(featureOrder);
const routeNodes = source => source.data.features.filter(feature => feature.geometry.type === 'Point' && feature.properties.trackId === route.id);
const geometryList = features => features.map(feature => clone(feature.geometry));

function assertRouteGeometry(source, expected) {
  const actual = routeLines(source).map(feature => feature.geometry.coordinates[0]);
  const wanted = expected.segments.flatMap(chunks);
  if (!isDeepStrictEqual(actual, wanted)) {
    let mismatch = 'chunk count';
    for (let chunk = 0; chunk < Math.min(actual.length, wanted.length); chunk++) {
      const index = actual[chunk].findIndex((point, i) => !isDeepStrictEqual(point, wanted[chunk][i]));
      if (index >= 0) { mismatch = `chunk ${chunk} point ${index}: ${JSON.stringify(actual[chunk][index])} vs ${JSON.stringify(wanted[chunk][index])}`; break; }
    }
    assert.fail(`route preview geometry differs: ${mismatch}; actual chunks ${actual.map(line => line.length)}, expected ${wanted.map(line => line.length)}`);
  }
}

test('one frozen rendered-node plan previews the same hidden-point geometry on differently projected maps, then commits and undoes', () => {
  const session = startRouteEdit(route);
  const panes = [createMap(6000), createMap(9000)];
  const layers = panes.map(({ map }) => new TrackLayer(map, viewport));
  layers.forEach(layer => layer.sync(overlay(session)));
  const picked = layers[0].pickEditableNode({ x: b[0] * 6000, y: b[1] * 6000 });
  assert.ok(picked?.controlMove, 'the actual rendered hit captures its immutable control plan');
  assert.equal(picked.controlMove.sourceSegments, session.track.segments);
  assert.deepEqual(picked.controlMove.spans.map(span => [span.startIndex, span.endIndex]), [[160, 180], [180, 200]]);
  const to = [b[0] + 0.0008, b[1] + 0.0007];
  const expected = applyTrackVisibleNodeMove(session.track, picked.controlMove, to);
  const before = panes.map(({ sources }) => ({ lines: geometryList(routeLines(sources.get('manual-tracks'))), background: backgroundLines(sources.get('manual-tracks'))[0].geometry }));
  const projectionCounts = panes.map(pane => pane.counts.project);

  layers.forEach(layer => layer.preview({ node: picked, coordinate: to }));
  panes.forEach(({ sources, counts }, index) => {
    assertRouteGeometry(sources.get('manual-tracks'), expected);
    assert.equal(backgroundLines(sources.get('manual-tracks'))[0].geometry, before[index].background, 'unrelated route geometry stays untouched');
    assert.equal(counts.project, projectionCounts[index], 'both maps consume the captured geographic plan without reprojecting it');
  });
  assert.deepEqual(route.segments, [allPoints], 'preview leaves the source record unchanged');

  const committed = moveEditNode(session, b, to, undefined, picked.controlMove);
  assert.deepEqual(committed.track.segments, expected.segments);
  layers.forEach(layer => layer.sync(overlay(committed)));
  panes.forEach(({ sources }) => assertRouteGeometry(sources.get('manual-tracks'), committed.track));

  const undone = undoRouteEdit(committed);
  layers.forEach(layer => layer.sync(overlay(undone)));
  panes.forEach(({ sources }) => assertRouteGeometry(sources.get('manual-tracks'), session.track));
});

test('preview cancellation restores canonical chunks, no-op does not straighten, and distant chunks retain geometry references', () => {
  const session = startRouteEdit(route), panes = [createMap(6000), createMap(9000)], layers = panes.map(({ map }) => new TrackLayer(map, viewport));
  layers.forEach(layer => layer.sync(overlay(session)));
  const picked = layers[0].pickEditableNode({ x: b[0] * 6000, y: b[1] * 6000 });
  assert.ok(picked?.controlMove);
  const noOp = moveEditNode(session, b, b, undefined, picked.controlMove);
  assert.equal(noOp, session);
  assert.deepEqual(applyTrackVisibleNodeMove(session.track, picked.controlMove, b).segments, session.track.segments);
  layers.forEach(layer => layer.preview({ node: picked, coordinate: b }));
  panes.forEach(({ sources }) => assertRouteGeometry(sources.get('manual-tracks'), session.track));
  layers.forEach(layer => layer.preview(null));
  const originalGeometry = panes.map(({ sources }) => routeLines(sources.get('manual-tracks')).map(feature => feature.geometry));
  const to = [b[0] - 0.0005, b[1] - 0.0004];

  layers.forEach(layer => layer.preview({ node: picked, coordinate: to }));
  panes.forEach(({ sources }, paneIndex) => {
    const after = routeLines(sources.get('manual-tracks'));
    assert.equal(after[0].geometry, originalGeometry[paneIndex][0], 'the distant prefix chunk is retained');
    assert.notEqual(after[1].geometry, originalGeometry[paneIndex][1], 'chunks containing moved hidden points are updated');
    assert.equal(after[2].geometry, originalGeometry[paneIndex][2], 'the distant suffix chunk is retained');
    assert.equal(after[3].geometry, originalGeometry[paneIndex][3], 'the far suffix chunk is retained');
  });
  layers.forEach(layer => layer.preview(null));
  panes.forEach(({ sources }, paneIndex) => {
    assertRouteGeometry(sources.get('manual-tracks'), session.track);
    routeLines(sources.get('manual-tracks')).forEach((feature, index) => assert.deepEqual(feature.geometry, originalGeometry[paneIndex][index], 'cancel restores the canonical baseline geometry'));
  });
});

test('terrain source refresh at the same camera keeps committed hidden points from becoming handles; zoom resamples', () => {
  const zoomPoints = allPoints.map(([lng, lat]) => [lng * 0.25, lat * 0.25]);
  const zoomTrack = { ...route, segments: [zoomPoints], nodes: [zoomPoints[160], zoomPoints[180], zoomPoints[200]] };
  const zoomB = zoomTrack.nodes[1];
  const session = startRouteEdit(zoomTrack), pane = createMap(6000, true, zoomB);
  pane.camera.lng = 0.005;
  const cameraViewport = () => {
    const span = 0.05 / 2 ** (pane.camera.zoom - 10), center = pane.camera.lng;
    const latitudeSpan = 0.004 / 2 ** (pane.camera.zoom - 10);
    return { west: center - span / 2, east: center + span / 2, south: -latitudeSpan / 2, north: latitudeSpan / 2, width: pane.camera.width, height: pane.camera.height, revision: 'terrain-frame' };
  };
  const layer = new TrackLayer(pane.map, cameraViewport);
  layer.sync(overlay(session));
  const picked = layer.pickEditableNode({ x: (zoomB[0] - pane.camera.lng) * 6000 + pane.camera.width / 2, y: zoomB[1] * 6000 + pane.camera.height / 2 });
  assert.ok(picked?.controlMove);
  const beforeNodes = routeNodes(pane.sources.get('manual-tracks')).map(feature => feature.geometry.coordinates);
  const beforeCount = beforeNodes.length;
  const to = [zoomB[0] + 0.0002, zoomB[1] + 0.0001];
  const expectedMove = moves(picked.controlMove, to);
  const expectedNodeKeys = beforeNodes.map(point => key(expectedMove.get(key(point)) ?? point)).sort();

  layer.preview({ node: picked, coordinate: to });
  pane.handlers.get('sourcedata')({ sourceId: 'terrain-dem' });
  const committed = moveEditNode(session, zoomB, to, undefined, picked.controlMove);
  layer.sync(overlay(committed));
  const afterTerrainNodes = routeNodes(pane.sources.get('manual-tracks')).map(feature => feature.geometry.coordinates);
  assert.equal(afterTerrainNodes.length, beforeCount, 'an unchanged camera reuses the original handle indices after geometry moves');
  assert.deepEqual(afterTerrainNodes.map(key).sort(), expectedNodeKeys, 'only the old sampled/explicit handles move with the route');

  pane.camera.lng += 0.001;
  pane.handlers.get('movestart')();
  layer.sync(overlay(committed));
  const afterPanCount = routeNodes(pane.sources.get('manual-tracks')).length;
  assert.equal(afterPanCount, beforeCount, 'same-zoom panning does not promote stretched hidden vertices to controls');

  pane.camera.zoom += 2;
  pane.handlers.get('zoom')();
  pane.handlers.get('movestart')();
  layer.sync(overlay(committed));
  const afterZoomCount = routeNodes(pane.sources.get('manual-tracks')).length;
  assert.ok(afterZoomCount > beforeCount, `zoom resamples more local handles (${beforeCount} -> ${afterZoomCount})`);
});

test('terrain pan drift cannot reveal stretched points in either pane; actual zoom still reveals detail', () => {
  const points = Array.from({ length: 601 }, (_, index) => [index / 100000, 0]);
  const middle = [0, 0];
  const session = startRouteEdit({ ...route, nodes: [], segments: [points] });
  const panes = [createMap(100000, true, middle), createMap(100000, true, middle)];
  const syncs = panes.map(() => new CameraSync());
  const layers = panes.map(pane => {
    pane.camera.lng = 0.003;
    pane.map.jumpTo = camera => {
      const oldZoom = pane.camera.zoom;
      Object.assign(pane.camera, { lng: camera.center[0], lat: camera.center[1], zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing });
      pane.handlers.get('movestart')();
      if (oldZoom !== camera.zoom) pane.handlers.get('zoom')();
    };
    return new TrackLayer(pane.map, () => {
      const half = 0.002 / 2 ** (pane.camera.zoom - 10);
      return { west: pane.camera.lng - half, east: pane.camera.lng + half, south: -half, north: half, width: 400, height: 400, revision: 0 };
    });
  });
  const state = { ...overlay(session), activeNode: null, nodeSelection: undefined };
  layers.forEach(layer => layer.sync(state));
  middle.splice(0, 2, ...routeNodes(panes[0].sources.get('manual-tracks')).find(feature => feature.geometry.coordinates[0] > 0.0022 && feature.geometry.coordinates[0] < 0.0026).geometry.coordinates);
  const picked = layers[0].pickEditableNode(panes[0].map.project(middle));
  assert.ok(picked?.controlMove);
  const originalControls = new Set(routeNodes(panes[0].sources.get('manual-tracks')).map(feature => key(feature.geometry.coordinates)));
  const to = [middle[0] + 0.00003, 0.0012];
  const committed = moveEditNode(session, middle, to, undefined, picked.controlMove);
  const hiddenIndices = picked.controlMove.spans.flatMap(span => Array.from({ length: span.endIndex - span.startIndex + 1 }, (_, i) => span.startIndex + i))
    .filter(index => !originalControls.has(key(points[index])));
  assert.ok(hiddenIndices.length > 10, 'regression stretches genuinely hidden raw vertices');
  const hidden = new Set(hiddenIndices.map(index => key(committed.track.segments[0][index])));
  const committedState = { ...state, saved: [committed.track, background] };
  layers.forEach(layer => layer.sync(committedState));
  const assertHidden = (pane, label) => assert.ok(routeNodes(pane.sources.get('manual-tracks')).every(feature => !hidden.has(key(feature.geometry.coordinates))), label);
  panes.forEach(pane => assertHidden(pane, 'release preserves the controls'));

  // Measured from the user's terrain-on preview. No zoom event is emitted for
  // this correction, but the follower's jumpTo emits one when copying it.
  panes[0].camera.lng -= 0.0003;
  panes[0].camera.zoom += 0.00004699415582898325;
  panes[0].handlers.get('movestart')();
  syncs[1].apply(panes[1].map, syncs[0].remember(panes[0].map));
  layers.forEach(layer => layer.sync(committedState));
  panes.forEach(pane => {
    assert.equal(cameraDetailZoom(pane.map), 10);
    assertHidden(pane, 'terrain panning must not promote hidden vertices in either pane');
  });

  panes[1].camera.zoom += 0.25;
  panes[1].handlers.get('zoom')();
  panes[1].handlers.get('movestart')();
  syncs[0].apply(panes[0].map, syncs[1].remember(panes[1].map));
  layers.forEach(layer => layer.sync(committedState));
  panes.forEach(pane => assert.ok(routeNodes(pane.sources.get('manual-tracks')).some(feature => hidden.has(key(feature.geometry.coordinates))), 'a deliberate quarter-level zoom reveals finer controls on both maps'));
});
