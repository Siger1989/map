import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  DrawingTouchSession,
  DrawingGestureBridge,
  DRAWING_TOUCH_GRACE_MS,
} from '../modules/tracks/DrawingGestureBridge.ts';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';
import {
  findSnap,
  joinSegments,
  connectedTracks,
  hasLoosePoints,
  draftSnapNodes,
} from '../modules/tracks/snapping.ts';
import {
  appendStroke,
  appendVertex,
  undoDraft,
  EMPTY_DRAFT,
  branchDraft,
  removeDraftNode,
  replaceDraftGeometry,
} from '../modules/tracks/draft.ts';
import {
  DEFAULT_TRACK_STYLE,
  normalizeTrackStyle,
} from '../modules/tracks/style.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { drawingRecord } from '../modules/tracks/archive.ts';
import { networkPath, vertexKey } from '../modules/guidance/network.ts';
import {
  insertTrackNode,
  connectTrackNodes,
} from '../modules/tracks/nodeOperations.ts';
const a = [104, 30],
  b = [104.001, 30],
  c = [104.002, 30],
  d = [104.003, 30];
const contact = (id) => ({ id, point: { x: id * 10, y: 100 } });
test('staggered fingers during the grace period never start ink; remaining finger cannot draw', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [],
    gesture = new DrawingTouchSession((e) => events.push(e));
  gesture.update('start', [contact(1)]);
  gesture.update('move', [contact(1)]);
  assert.equal(gesture.update('start', [contact(1), contact(2)]), true);
  gesture.update('move', [contact(1), contact(2)]);
  gesture.update('end', [contact(1)]);
  gesture.update('move', [contact(1)]);
  gesture.update('end', []);
  t.mock.timers.tick(DRAWING_TOUCH_GRACE_MS + 1);
  assert.deepEqual(events, []);
  gesture.update('start', [contact(3)]);
  gesture.update('end', []);
  assert.equal(events.at(-1).reason, 'release');
});
test('public bridge preserves native two-finger events and restores map controls', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handlers = new Map(),
    windowHandlers = new Map(),
    emitted = [],
    canvas = {};
  const control = () => ({
    active: true,
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
  Object.assign(canvas, {
    ownerDocument: {
      defaultView: {
        addEventListener: (n, f) => windowHandlers.set(n, f),
        removeEventListener: (n) => windowHandlers.delete(n),
      },
    },
    classList: { toggle() {} },
    contains: (t) => t === canvas,
    clientWidth: 400,
    clientHeight: 800,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  });
  const map = {
    on: (n, f) => handlers.set(n, f),
    off: (n) => handlers.delete(n),
    getCanvasContainer: () => ({
      ...canvas,
      clientHeight: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 0 }),
    }),
    getCanvas: () => canvas,
    dragPan: control(),
    doubleClickZoom: control(),
    stop() {},
  };
  const bridge = new DrawingGestureBridge(map, (e) => emitted.push(e));
  bridge.configure(true);
  const event = (count) => ({
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    originalEvent: {
      touches: Array.from({ length: count }, (_, i) => ({
        identifier: i,
        clientX: 50 + i * 60,
        clientY: 100,
        target: canvas,
      })),
    },
  });
  const one = event(1);
  handlers.get('touchstart')(one);
  assert.equal(emitted.length, 0);
  t.mock.timers.tick(DRAWING_TOUCH_GRACE_MS);
  assert.deepEqual(
    emitted[0].point,
    { x: 50, y: 100 },
    'zero-height wrapper cannot corrupt canvas coordinates',
  );
  assert.equal(
    one.prevented,
    false,
    'the first touch must reach MapLibre pinch recognizers too',
  );
  assert.equal(map.dragPan.active, false);
  const two = event(2);
  handlers.get('touchstart')(two);
  assert.equal(
    emitted.at(-1).type,
    'cancel',
    'late second finger cancels tentative ink',
  );
  assert.equal(two.prevented, false);
  assert.equal(map.dragPan.active, true);
  handlers.get('movestart')();
  handlers.get('touchend')(event(1));
  assert.equal(map.dragPan.active, false);
  handlers.get('touchend')(event(0));
  assert.equal(map.dragPan.active, true);
  const before = emitted.length;
  handlers.get('mousedown')({ originalEvent: { button: 0 } });
  assert.equal(
    emitted.length,
    before,
    'compatibility mouse event after touch is ignored',
  );
  bridge.dispose();
  assert.equal(map.doubleClickZoom.active, true);
  assert.equal(handlers.size, 0);
  assert.equal(windowHandlers.size, 0);
});
test('a late second finger cancels the whole uncommitted stroke and preserves prior saved geometry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const drawing = new DrawingSession();
  const original = [
    [100.05, 20],
    [100.1, 20],
  ];
  const committed = [original];
  const updates = [];
  const gesture = new DrawingTouchSession((event) => {
    const update = drawing.input(event, {
      ...options,
      anchor: original.at(-1),
    });
    updates.push(update);
    if (update.stroke) committed.push(update.stroke);
  });
  const finger = (y) => ({ id: 1, point: { x: 100, y } });
  gesture.update('start', [finger(248)]);
  gesture.update('move', [finger(280)]);
  t.mock.timers.tick(DRAWING_TOUCH_GRACE_MS);
  gesture.update('move', [finger(340)]);
  assert.ok(updates.at(-1).preview);
  gesture.update('start', [finger(340), contact(2)]);
  assert.equal(updates.at(-1).preview, null);
  gesture.update('end', [finger(340)]);
  gesture.update('move', [finger(400)]);
  gesture.update('end', []);
  assert.deepEqual(committed, [original]);
});

test('normal single-finger strokes replay early samples in order and release exactly once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const gesture = new DrawingTouchSession((event) => events.push(event));
  gesture.update('start', [contact(1)]);
  gesture.update('move', [{ ...contact(1), point: { x: 11, y: 120 } }]);
  t.mock.timers.tick(DRAWING_TOUCH_GRACE_MS);
  gesture.update('move', [{ ...contact(1), point: { x: 12, y: 140 } }]);
  gesture.update('end', []);
  t.mock.timers.tick(1000);
  assert.deepEqual(
    events.map((event) => event.type),
    ['start', 'move', 'move', 'end'],
  );
  assert.deepEqual(
    events.slice(0, 3).map((event) => event.point.y),
    [100, 120, 140],
  );
  assert.equal(events.at(-1).reason, 'release');
});

test('cancellation and leaving drawing before the grace timer fires never place a point', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const gesture = new DrawingTouchSession((event) => events.push(event));
  gesture.update('start', [contact(1)]);
  gesture.update('cancel', []);
  t.mock.timers.tick(1000);
  gesture.update('start', [contact(2)]);
  gesture.reset(false, 'interrupt');
  t.mock.timers.tick(1000);
  assert.deepEqual(events, []);
});
const options = {
  mode: 'freehand',
  anchor: null,
  length: 48,
  width: 400,
  height: 800,
  candidates: [],
  snapping: true,
  project: (c) => ({ x: (c[0] - 100) * 1000, y: c[1] * 10 }),
  unproject: (p) => [100 + p.x / 1000, p.y / 10],
};
test('precision origin is offset, uncommitted until release, and cancels for navigation', () => {
  const s = new DrawingSession();
  const first = s.input({ type: 'start', point: { x: 100, y: 244 } }, options);
  assert.equal(first.preview.tip.y, 200);
  assert.equal(first.stroke, undefined);
  assert.equal(
    s.input({ type: 'end', reason: 'navigation' }, options).anchor,
    undefined,
  );
  s.input({ type: 'start', point: { x: 100, y: 244 } }, options);
  assert.deepEqual(
    s.input({ type: 'end', reason: 'release' }, options).anchor,
    [100.1, 20],
  );
});
test('smooth ink starts at confirmed coordinate and resumes exactly at last pen tip', () => {
  const s = new DrawingSession(),
    origin = [100.1, 20],
    o = { ...options, anchor: origin };
  s.input({ type: 'start', point: { x: 100, y: 248 } }, o);
  s.input({ type: 'move', point: { x: 100, y: 310 } }, o);
  const result = s.input({ type: 'end', reason: 'navigation' }, o);
  assert.strictEqual(result.stroke[0], origin);
  assert.equal(result.stroke.at(-1)[1], 26.2);
  const next = { ...o, anchor: result.stroke.at(-1) };
  s.input({ type: 'start', point: { x: 100, y: 310 } }, next);
  s.input({ type: 'move', point: { x: 100, y: 350 } }, next);
  assert.strictEqual(
    s.input({ type: 'end', reason: 'release' }, next).stroke[0],
    next.anchor,
  );
});
test('touch away from tether handle cannot silently replace the origin', () => {
  const s = new DrawingSession(),
    o = { ...options, anchor: [100.1, 20] };
  assert.ok(s.input({ type: 'start', point: { x: 250, y: 250 } }, o).hint);
  s.input({ type: 'move', point: { x: 260, y: 250 } }, o);
  assert.deepEqual(s.input({ type: 'end', reason: 'release' }, o), {
    preview: null,
    hint: '',
  });
});
test('point snap uses exact existing coordinate; outside radius does not magnetize', () => {
  const node = [100.1, 20],
    o = { ...options, candidates: [node], mode: 'points' };
  assert.strictEqual(
    findSnap({ x: 109, y: 200 }, [node], o.project).coordinate,
    node,
  );
  assert.equal(findSnap({ x: 115, y: 200 }, [node], o.project), null);
  const s = new DrawingSession();
  assert.equal(
    s.input({ type: 'start', point: { x: 109, y: 244 } }, o).preview.snapped,
    true,
  );
  assert.strictEqual(
    s.input({ type: 'end', reason: 'release' }, o).vertex,
    node,
  );
});
test('stroke endpoint snaps to node without jumping to finger', () => {
  const s = new DrawingSession(),
    target = [100.1, 26.5],
    o = { ...options, anchor: [100.1, 20], candidates: [target] };
  s.input({ type: 'start', point: { x: 100, y: 248 } }, o);
  assert.equal(
    s.input({ type: 'move', point: { x: 100, y: 310 } }, o).preview.snapped,
    true,
  );
  assert.strictEqual(
    s.input({ type: 'end', reason: 'release' }, o).stroke.at(-1),
    target,
  );
});
test('segment assembly handles reversed strokes and loops, never crosses gaps or branches', () => {
  assert.deepEqual(
    joinSegments([
      [a, b],
      [c, b],
      [c, d],
    ]),
    [[a, b, c, d]],
  );
  assert.deepEqual(
    joinSegments([
      [a, b],
      [b, c],
      [c, a],
    ]),
    [[a, b, c, a]],
  );
  assert.equal(
    joinSegments([
      [a, b],
      [c, d],
    ]).length,
    2,
  );
  assert.equal(
    joinSegments([
      [a, b],
      [b, c],
      [b, d],
    ]).length,
    3,
  );
  const tracks = [
    { id: 'a', segments: [[a, b]] },
    { id: 'b', segments: [[b, c]] },
    {
      id: 'c',
      segments: [
        [
          [110, 30],
          [111, 30],
        ],
      ],
    },
  ];
  assert.deepEqual(
    connectedTracks(tracks[0], tracks).map((t) => t.id),
    ['a', 'b'],
  );
});
test('mixed-mode undo removes only latest operation and preserves saved continuation baseline', () => {
  assert.equal(hasLoosePoints([[a], [a, b]]), false);
  assert.equal(hasLoosePoints([[c], [a, b]]), true);
  const initial = appendStroke(EMPTY_DRAFT, [a, b]);
  const point = appendVertex(initial, c);
  assert.deepEqual(point.segments.at(-1), [b, c]);
  assert.deepEqual(undoDraft(point).segments, initial.segments);
  const baseline = { ...initial, history: [] };
  assert.deepEqual(undoDraft(appendStroke(baseline, [b, c])), baseline);
  assert.deepEqual(undoDraft(baseline), baseline);
});
test('stored nodes survive, bad nodes are rejected, legacy line style is readable', () => {
  const track = {
    id: '1',
    name: 'test',
    createdAt: 1,
    segments: [[a, b]],
    nodes: [a, b],
  };
  assert.deepEqual(parseSavedTracks(JSON.stringify([track]))[0].nodes, [a, b]);
  assert.equal(
    parseSavedTracks(JSON.stringify([{ ...track, nodes: [[999, 999]] }]))
      .length,
    0,
  );
  assert.deepEqual(normalizeTrackStyle(null), DEFAULT_TRACK_STYLE);
  assert.deepEqual(normalizeTrackStyle({ color: 'red;bad', width: 999 }), {
    color: DEFAULT_TRACK_STYLE.color,
    width: 5,
    opacity: 1,
  });
});
test('map style is valid and solitary precision points never become invalid lines', async () => {
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
  const sources = {},
    layers = [];
  let data;
  const map = {
    getSource: (n) => sources[n],
    addSource: (n, s) => {
      sources[n] = {
        ...s,
        setData: (d) => {
          if (n === 'manual-tracks') data = d;
        },
      };
    },
    getLayer: (n) => layers.find((l) => l.id === n),
    getStyle: () => ({ layers }),
    addLayer: (l) => layers.push(l),
    moveLayer() {},
    project: (p) => ({ x: (p[0] - 104) * 50000, y: p[1] }),
  };
  const controller = new TrackLayer(map),
    state = {
      saved: [],
      draft: [[a]],
      nodes: [a],
      visible: true,
      style: { color: '#55d6ff', width: 1 },
    };
  controller.sync(state);
  assert.ok(data.features.every((f) => f.geometry.type === 'Point'));
  const styleSources = Object.fromEntries(
    Object.entries(sources).map(([key, { setData, ...source }]) => [
      key,
      source,
    ]),
  );
  assert.deepEqual(
    validateStyleMin({ version: 8, sources: styleSources, layers }).map(
      (e) => e.message,
    ),
    [],
  );
  controller.sync({ ...state, draft: [[a, b]], visible: false });
  assert.equal(data.features.length, 0);
  // A legacy route has no explicit middle nodes. Starting a branch must keep
  // the previously visible, selectable middle handles in the drawing overlay.
  controller.sync({
    ...state,
    draft: [[a, b, c, d], [c]],
    nodes: [c],
    selectedId: 'draft',
    drawing: true,
  });
  const handles = data.features.filter((f) => f.geometry.type === 'Point');
  assert.ok(handles.some((f) => f.geometry.coordinates[0] === b[0]));
  assert.ok(handles.some((f) => f.geometry.coordinates[0] === c[0]));
  assert.equal(handles.length, 4, 'shared branch origin is not duplicated');
});

test('a branch snaps exactly back to a legacy interior node and survives save, reload and undo', () => {
  const A = [100.05, 20],
    B = [100.1, 20],
    C = [100.2, 20],
    D = [100.3, 20];
  const away = [100.2, 25],
    returning = [100.1, 25];
  const original = [[A, B, C, D]],
    before = JSON.stringify(original);
  const base = {
    segments: [...original, [C]],
    kinds: ['freehand', 'points'],
    nodes: [C],
    pointLine: 1,
    history: [],
  };
  const draft = appendVertex(appendVertex(base, away), returning);
  const candidates = draftSnapNodes(draft.segments);
  assert.equal(candidates.filter((p) => p === C).length, 1);
  assert.ok(
    candidates.includes(B),
    'unlisted legacy middle node is a snap target',
  );
  const session = new DrawingSession();
  const o = { ...options, mode: 'points', lastVertex: returning, candidates };
  const preview = session.input(
    { type: 'start', point: { x: 104, y: 246 } },
    o,
  );
  assert.equal(preview.preview.snapped, true);
  const result = session.input({ type: 'end', reason: 'release' }, o);
  assert.strictEqual(
    result.vertex,
    B,
    'coordinate identity closes the network without a tiny gap',
  );
  const closed = appendVertex(draft, result.vertex);
  const record = drawingRecord({
    segments: closed.segments,
    nodes: [C, away, returning, B],
    style: DEFAULT_TRACK_STYLE,
    id: 'loop',
    name: 'loop',
    createdAt: 1,
    now: 2,
  });
  const loaded = parseSavedTracks(JSON.stringify([record]))[0];
  assert.deepEqual(loaded.segments, [original[0], [C, away, returning, B]]);
  assert.deepEqual(
    networkPath(loaded.segments, B, C).coordinates.map(vertexKey),
    [B, C].map(vertexKey),
  );
  assert.deepEqual(
    networkPath([loaded.segments[1]], B, C).coordinates.map(vertexKey),
    [B, returning, away, C].map(vertexKey),
  );
  assert.deepEqual(undoDraft(closed).segments, draft.segments);
  assert.equal(
    JSON.stringify(original),
    before,
    'original route geometry stays unchanged',
  );
});

test('draft node toolbar edits and branch creation undo without saving or losing the old baseline', () => {
  const base = {
    segments: [[a, b, c, d]],
    kinds: ['points'],
    pointLine: 0,
    history: [],
  };
  const branched = branchDraft(base, b);
  assert.deepEqual(branched.segments, [[a, b, c, d], [b]]);
  assert.deepEqual(undoDraft(branched), { ...base, nodes: undefined });
  const continued = appendVertex(branched, [104.001, 30.001]);
  assert.deepEqual(undoDraft(continued).segments, branched.segments);
  const middle = [104.0005, 30];
  const inserted = insertTrackNode(
    { id: 'draft', name: 'draft', createdAt: 1, ...base },
    middle,
  );
  const edited = replaceDraftGeometry(base, inserted.segments, inserted.nodes);
  assert.deepEqual(edited.segments[0], [a, middle, b, c, d]);
  const removed = removeDraftNode(edited, middle);
  assert.deepEqual(removed.segments, base.segments);
  assert.deepEqual(undoDraft(removed).segments, edited.segments);
  assert.deepEqual(undoDraft(edited), { ...base, nodes: undefined });
  assert.throws(
    () => removeDraftNode({ ...base, segments: [[a, b]] }, a),
    /至少保留/,
  );
});

test('an isolated draft point can be deleted while preserving the rest, and direct node connection closes a loop', () => {
  const loose = [104.005, 30.002];
  const base = {
    segments: [[a, b, c, d], [loose]],
    kinds: ['freehand', 'points'],
    pointLine: 1,
    history: [],
  };
  const removed = removeDraftNode(base, loose);
  assert.deepEqual(removed.segments, [[a, b, c, d]]);
  assert.equal(removed.pointLine, null);
  assert.deepEqual(undoDraft(removed), { ...base, nodes: undefined });
  const track = {
    id: 'draft',
    name: 'draft',
    createdAt: 1,
    segments: [
      [a, b, c, d],
      [b, loose],
    ],
  };
  const joined = connectTrackNodes(track, loose, track, c, 'draft');
  assert.deepEqual(joined.segments, [...track.segments, [loose, c]]);
  assert.deepEqual(track.segments, [
    [a, b, c, d],
    [b, loose],
  ]);
});

test('precision drawing can join an existing node even when road snapping has no road there', () => {
  const node = [100.1, 20];
  const o = {
    ...options,
    mode: 'points',
    lastVertex: [100.05, 18],
    candidates: [node],
    roadSnapping: true,
    snapRoad: () => ({ status: 'ready', match: null }),
  };
  const s = new DrawingSession();
  s.input({ type: 'start', point: { x: 109, y: 244 } }, o);
  assert.equal(
    s.input({ type: 'end', reason: 'navigation' }, o).vertex,
    undefined,
  );
  s.input({ type: 'start', point: { x: 109, y: 244 } }, o);
  assert.strictEqual(
    s.input({ type: 'end', reason: 'release' }, o).vertex,
    node,
  );
});
