import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  DrawingTouchSession,
  DrawingGestureBridge,
} from '../modules/tracks/DrawingGestureBridge.ts';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';
import {
  findSnap,
  joinSegments,
  connectedTracks,
  hasLoosePoints,
} from '../modules/tracks/snapping.ts';
import {
  appendStroke,
  appendVertex,
  undoDraft,
  EMPTY_DRAFT,
} from '../modules/tracks/draft.ts';
import {
  DEFAULT_TRACK_STYLE,
  normalizeTrackStyle,
} from '../modules/tracks/style.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
const a = [104, 30],
  b = [104.001, 30],
  c = [104.002, 30],
  d = [104.003, 30];
const contact = (id) => ({ id, point: { x: id * 10, y: 100 } });
test('single → two fingers → one finger cannot leave phantom ink or points', () => {
  const events = [],
    gesture = new DrawingTouchSession((e) => events.push(e));
  gesture.update('start', [contact(1)]);
  gesture.update('move', [contact(1)]);
  assert.equal(gesture.update('start', [contact(1), contact(2)]), true);
  gesture.update('move', [contact(1), contact(2)]);
  gesture.update('end', [contact(1)]);
  gesture.update('move', [contact(1)]);
  gesture.update('end', []);
  assert.deepEqual(
    events.map((e) => [e.type, e.reason]),
    [
      ['start', undefined],
      ['move', undefined],
      ['end', 'navigation'],
    ],
  );
  gesture.update('start', [contact(3)]);
  gesture.update('end', []);
  assert.equal(events.at(-1).reason, 'release');
});
test('public bridge preserves native two-finger events and restores map controls', () => {
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
    getCanvasContainer: () => canvas,
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
  assert.equal(one.prevented, true);
  assert.equal(map.dragPan.active, false);
  const two = event(2);
  handlers.get('touchstart')(two);
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
          data = d;
        },
      };
    },
    getLayer: (n) => layers.find((l) => l.id === n),
    addLayer: (l) => layers.push(l),
    moveLayer() {},
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
});
