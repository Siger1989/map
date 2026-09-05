import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as THREE from 'three';
import { FeatureDragBridge } from '../modules/map/FeatureDragBridge.ts';
import { moveTrackNode, nodeHandles } from '../modules/tracks/editing.ts';
import {
  appendStroke,
  appendVertex,
  moveDraftNode,
  undoDraft,
  draftVertices,
  EMPTY_DRAFT,
} from '../modules/tracks/draft.ts';
import { newAnnotation } from '../modules/annotations/data.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';

test('model bodies are selectable; drag updates retain the pressed marker and geometry, hidden models cannot be picked', async (t) => {
  const compiled = await build({
    entryPoints: ['modules/annotations/AnnotationLayer.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'map-dom-adapter',
        setup(builder) {
          builder.onResolve({ filter: /^three$/ }, () => ({
            path: import.meta.resolve('three'),
            external: true,
          }));
          builder.onResolve({ filter: /^maplibre-gl$/ }, () => ({
            path: 'maplibre',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
        export class Marker {
          constructor({ element }) { this.element = element; }
          getElement() { return this.element; }
          setLngLat(p) { this.coordinate = p; return this; }
          addTo() { return this; }
          remove() { this.removed = true; }
        }
        export class MercatorCoordinate {
          static fromLngLat(p) { return { x: p[0] / 360, y: -p[1] / 180, meterInMercatorCoordinateUnits: () => 1e-5 }; }
        }
      `,
          }));
        },
      },
    ],
  });
  const { AnnotationLayer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      style: { setProperty() {} },
      dataset: {},
      setAttribute() {},
    }),
  };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const selected = [],
    layer = new AnnotationLayer((id) => selected.push(id));
  layer.map = {
    getCanvas: () => ({ clientWidth: 400, clientHeight: 400 }),
    triggerRepaint() {},
  };
  const item = newAnnotation('box', a, 1000, 'box-1'),
    settings = { terrain: true, exaggeration: 1 };
  layer.update([item], null, settings);
  const marker = layer.markers.get(item.id);
  marker.getElement().onclick({ stopPropagation() {} });
  assert.deepEqual(selected, [item.id]);
  layer.update([item], item.id, settings);
  assert.strictEqual(
    layer.markers.get(item.id),
    marker,
    'selection must not remove the held DOM target',
  );
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  camera.position.set(0, 0, 4000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  layer.camera.projectionMatrix
    .copy(camera.projectionMatrix)
    .multiply(camera.matrixWorldInverse);
  layer.hasRendered = true;
  assert.equal(layer.pick({ x: 200, y: 200 }), item.id);
  assert.equal(layer.pick({ x: 2, y: 2 }), null);
  const frame = layer.frames.get(item.id),
    geometry = frame.children[0].children[0].geometry;
  const position = frame.position.clone();
  layer.update([{ ...item, coordinates: [104.0001, 30] }], item.id, settings);
  assert.strictEqual(layer.frames.get(item.id), frame);
  assert.strictEqual(frame.children[0].children[0].geometry, geometry);
  assert.notDeepEqual(frame.position.toArray(), position.toArray());
  assert.strictEqual(layer.markers.get(item.id), marker);
  layer.update([{ ...item, visible: false }], item.id, settings);
  assert.equal(marker.removed, true);
  assert.equal(layer.pick({ x: 200, y: 200 }), null);
  layer.onRemove();
});

const a = [104, 30],
  b = [104.001, 30],
  c = [104.002, 30],
  moved = [104.001, 30.001];

test('moving a junction preserves ID, metric coordinates and metadata; only this track changes', () => {
  const original = {
    id: 'track-1',
    name: '山路',
    createdAt: 123,
    style: { color: '#ffffff', width: 2 },
    segments: [
      [a, b],
      [b, c],
      [[b[0] + 1e-7, b[1]], c],
    ],
    nodes: [a, b, c],
  };
  const snapshot = structuredClone(original);
  const result = moveTrackNode(original, b, moved);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(result.segments[0], [a, moved]);
  assert.deepEqual(result.segments[1], [moved, c]);
  assert.deepEqual(
    result.segments[2],
    original.segments[2],
    'nearby independent points are not welded',
  );
  assert.deepEqual(result.nodes, [a, moved, c]);
  assert.equal(result.id, original.id);
  assert.deepEqual(parseSavedTracks(JSON.stringify([result]))[0], result);
});

test('continued track nodes move and undo with the actual line; later draw operations still undo in order', () => {
  const baseline = {
    segments: [
      [a, b],
      [b, c],
    ],
    kinds: ['freehand', 'freehand'],
    nodes: [a, b, c],
    history: [],
    pointLine: null,
  };
  const changed = moveDraftNode(baseline, b, moved);
  assert.deepEqual(draftVertices(changed), [a, moved, c]);
  assert.deepEqual(undoDraft(changed), baseline);
  const point = appendVertex(changed, [104.003, 30]);
  assert.deepEqual(undoDraft(point), changed);
  const stroke = appendStroke(point, [
    [104.003, 30],
    [104.004, 30],
  ]);
  assert.deepEqual(undoDraft(stroke), point);
  assert.deepEqual(undoDraft(undoDraft(undoDraft(stroke))), baseline);
  assert.strictEqual(moveDraftNode(baseline, b, b), baseline);
  assert.strictEqual(moveDraftNode(baseline, [1, 2], moved), baseline);
  const draft = appendVertex(appendVertex(EMPTY_DRAFT, a), b);
  assert.deepEqual(
    undoDraft(moveDraftNode(draft, b, moved)).segments,
    draft.segments,
  );
});

test('selected freehand routes reveal more handles as zoom grows; stale nodes are not editable ghosts', () => {
  const points = Array.from({ length: 51 }, (_, i) => [i / 10, 20]);
  const zoom = (scale) => (point) => ({
    x: point[0] * scale,
    y: point[1] * scale,
  });
  const sparse = nodeHandles([points], [points[10], [99, 99]], false, zoom(10));
  assert.equal(sparse.length, 3);
  assert.ok(!sparse.some((point) => point[0] === 99));
  const low = nodeHandles([points], [], true, zoom(10));
  const high = nodeHandles([points], [], true, zoom(100));
  assert.ok(high.length > low.length);
  assert.deepEqual(high[0], points[0]);
  assert.ok(high.some((point) => point === points.at(-1)));
});

function emitter() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    fire(name, event) {
      for (const fn of listeners.get(name) ?? []) fn(event);
    },
  };
}

function fixture(t, kind = 'track') {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const win = emitter(),
    container = emitter(),
    classes = new Set(),
    previews = [],
    commits = [],
    begins = [];
  container.classList = {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
  };
  const canvas = {
    ownerDocument: { defaultView: win },
    clientWidth: 400,
    clientHeight: 800,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 1600,
    }),
  };
  container.contains = (target) => target === canvas;
  const control = (enabled = true) => ({
    active: enabled,
    isEnabled() {
      return this.active;
    },
    enable() {
      this.active = true;
    },
    disable() {
      this.active = false;
    },
  });
  const map = {
    getCanvas: () => canvas,
    getContainer: () => container,
    stop() {},
    project: (p) => ({ x: p[0] * 10, y: p[1] * 10 }),
    unproject: (p) => ({ toArray: () => [p[0] / 10, p[1] / 10] }),
    dragPan: control(),
    dragRotate: control(false),
    touchZoomRotate: control(),
    touchPitch: control(),
    doubleClickZoom: control(),
    scrollZoom: control(),
    keyboard: control(),
  };
  let enabled = true;
  const target =
    kind === 'track'
      ? { kind, node: { trackId: 't1', coordinate: [10, 20] } }
      : { kind, id: 'a1', coordinate: [10, 20] };
  const bridge = new FeatureDragBridge(map, {
    enabled: () => enabled,
    hit: () => target,
    begin: (value) => begins.push(value),
    preview: (value) => previews.push(value),
    commit: (value) => commits.push(value),
  });
  t.after(() => bridge.dispose());
  const event = (id = 1, x = 100, y = 200) => ({
    pointerId: id,
    button: 0,
    clientX: x * 2,
    clientY: y * 2,
    target: canvas,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
    stopPropagation() {},
  });
  return {
    win,
    map,
    container,
    bridge,
    previews,
    commits,
    begins,
    classes,
    event,
    disable: () => {
      enabled = false;
    },
  };
}

test('short taps and quick pans stay native; hold without movement never writes', (t) => {
  const f = fixture(t);
  f.win.fire('pointerdown', f.event());
  t.mock.timers.tick(200);
  f.win.fire('pointerup', f.event());
  t.mock.timers.tick(500);
  assert.equal(f.begins.length, 0);
  f.win.fire('pointerdown', f.event());
  f.win.fire('pointermove', f.event(1, 110, 200));
  t.mock.timers.tick(500);
  assert.equal(f.begins.length, 0);
  assert.equal(f.map.dragPan.active, true);
  f.win.fire('pointerup', f.event());
  f.win.fire('pointerdown', f.event());
  t.mock.timers.tick(480);
  assert.equal(f.begins.length, 1);
  assert.equal(f.map.dragPan.active, false);
  f.win.fire('pointerup', f.event());
  assert.equal(f.commits.length, 0);
  assert.equal(f.map.dragPan.active, true);
  assert.equal(f.map.dragRotate.active, false);
});

test('node hold previews without writes, release commits once and suppresses following map click', (t) => {
  const f = fixture(t);
  f.win.fire('pointerdown', f.event());
  t.mock.timers.tick(480);
  f.win.fire('pointermove', f.event(1, 130, 240));
  assert.deepEqual(f.previews.at(-1).coordinate, [13, 24]);
  assert.equal(f.commits.length, 0);
  f.win.fire('pointerup', f.event(1, 130, 240));
  assert.equal(f.commits.length, 1);
  assert.deepEqual(f.commits[0].coordinate, [13, 24]);
  assert.equal(f.previews.at(-1), null);
  const click = f.event();
  f.container.fire('click', click);
  assert.equal(click.stopped, true);
  assert.equal(f.bridge.blocksClick(), true);
  t.mock.timers.tick(601);
  assert.equal(f.bridge.blocksClick(), false);
  assert.equal(f.classes.size, 0);
});

test('marker label drag preserves finger offset rather than jumping its ground anchor', (t) => {
  const f = fixture(t, 'annotation');
  f.win.fire('pointerdown', f.event(1, 110, 185));
  t.mock.timers.tick(480);
  f.win.fire('pointerup', f.event(1, 150, 200));
  assert.deepEqual(f.commits[0].coordinate, [14, 21.5]);
});

for (const phase of ['waiting', 'dragging'])
  test(`second finger cancels ${phase} and preserves two-finger navigation until all lift`, (t) => {
    const f = fixture(t);
    f.win.fire('pointerdown', f.event());
    if (phase === 'dragging') {
      t.mock.timers.tick(480);
      f.win.fire('pointermove', f.event(1, 140, 200));
    }
    f.win.fire('pointerdown', f.event(2, 150, 250));
    t.mock.timers.tick(1000);
    assert.equal(f.map.touchZoomRotate.active, true);
    assert.equal(f.map.dragPan.active, true);
    f.win.fire('pointerup', f.event(2));
    f.win.fire('pointermove', f.event(1, 180, 300));
    f.win.fire('pointerup', f.event());
    assert.equal(f.commits.length, 0);
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(480);
    f.win.fire('pointerup', f.event(1, 140, 200));
    assert.equal(f.commits.length, 1);
  });

for (const reason of [
  'pointercancel',
  'blur',
  'escape',
  'disable',
  'outside',
  'sky',
  'dispose',
])
  test(`${reason} rolls back the drag preview and restores original map controls`, (t) => {
    const f = fixture(t);
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(480);
    f.win.fire('pointermove', f.event(1, 130, 220));
    if (reason === 'escape')
      f.win.fire('keydown', { ...f.event(), key: 'Escape' });
    else if (reason === 'disable') {
      f.disable();
      f.bridge.cancel();
    } else if (reason === 'outside')
      f.win.fire('pointerup', f.event(1, 450, 200));
    else if (reason === 'sky') {
      f.map.unproject = () => ({ toArray: () => [80, 80] });
      f.win.fire('pointerup', f.event(1, 130, 230));
    } else if (reason === 'dispose') f.bridge.dispose();
    else f.win.fire(reason, f.event());
    assert.equal(f.commits.length, 0);
    assert.equal(f.previews.at(-1), null);
    assert.equal(f.map.dragPan.active, true);
    assert.equal(f.map.dragRotate.active, false);
    assert.equal(f.classes.size, 0);
    if (reason === 'dispose')
      assert.ok(
        [...f.win.listeners.values()].every((listeners) => !listeners.size),
      );
  });

test('rendered route features carry selection IDs and exact draggable coordinates; preview never mutates persisted input', async () => {
  const compiled = await build({
    entryPoints: ['modules/tracks/TrackLayer.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { TrackLayer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const layers = new Map(),
    sources = new Map();
  let data,
    hits = [];
  const map = {
    getSource: (id) => sources.get(id),
    addSource: (id) =>
      sources.set(id, {
        setData: (next) => {
          data = next;
        },
      }),
    getLayer: (id) => layers.get(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    moveLayer() {},
    project: (p) => ({ x: (p[0] - 104) * 100000, y: (p[1] - 30) * 100000 }),
    queryRenderedFeatures: (_, options) =>
      hits.filter((hit) => options.layers.includes(hit.layer.id)),
  };
  const layer = new TrackLayer(map);
  const track = {
    id: 'saved-id',
    name: '山路',
    createdAt: 1,
    segments: [[a, b, c]],
    nodes: [b],
  };
  const state = {
    saved: [track],
    draft: [[a]],
    nodes: [a],
    visible: true,
    style: { color: '#55d6ff', width: 1 },
    selectedId: track.id,
  };
  layer.sync(state);
  const line = data.features.find((f) => f.geometry.type === 'MultiLineString');
  assert.equal(line.properties.trackId, track.id);
  assert.equal(line.properties.selected, true);
  const node = data.features.find(
    (f) => f.geometry.type === 'Point' && f.properties.lng === b[0],
  );
  hits = [
    {
      ...node,
      layer: { id: 'manual-track-node' },
      geometry: { type: 'Point', coordinates: [999, 999] },
    },
  ];
  assert.deepEqual(
    layer.pickNode({ x: 109, y: 0 }).coordinate,
    b,
    'read exact stored coordinate, not quantized GeoJSON query position',
  );
  assert.equal(layer.pickTrack({ x: 109, y: 0 }), track.id);
  hits = [{ ...line, layer: { id: 'manual-track-line' } }];
  assert.equal(layer.pickTrack({ x: 50, y: 0 }), track.id);
  layer.sync({
    ...state,
    preview: { node: { trackId: track.id, coordinate: b }, coordinate: moved },
  });
  assert.deepEqual(
    data.features.find((f) => f.geometry.type === 'MultiLineString').geometry
      .coordinates,
    [[a, moved, c]],
  );
  assert.deepEqual(track.segments, [[a, b, c]]);
  layer.sync({ ...state, visible: false });
  assert.equal(data.features.length, 0);
});
