import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeMapInteractionAdapter } from '../modules/map/native/interaction.ts';

function harness(extra = {}) {
  const handlers = new Map(), callbacks = [], notices = [], gestures = [];
  const ready = (value) => ({ status: 'ready', value });
  const client = {
    isReady: true,
    subscribe(mapId, name, listener) {
      const key = `${mapId}:${name}`;
      const listeners = handlers.get(key) ?? new Set();
      listeners.add(listener); handlers.set(key, listeners);
      return () => listeners.delete(listener);
    },
    notify(mapId, command, payload) { notices.push({ mapId, command, payload }); },
    cameraFrame() { return { viewport: { x: 0, y: 0, width: 300, height: 200 }, cssScale: 1 }; },
    geometry() {
      return {
        project: ([x, y]) => ready({ x: x * 10, y: y * 10 }),
        unproject: ({ x, y }) => extra.blockUnproject ? { status: 'blocked', reason: 'dem-missing' } : ready({ coordinate: [x / 10, y / 10], elevationMeters: 0 }),
      };
    },
  };
  const target = { kind: 'track', node: { trackId: 'draft', coordinate: [1, 2] } };
  const adapter = new NativeMapInteractionAdapter({
    client,
    mapId: 'main',
    enabled: () => true,
    resolveTarget: (hit) => extra.resolveTarget ? extra.resolveTarget(hit) : hit.ids.includes('track-node') ? target : null,
    onDragBegin: (value) => callbacks.push(['begin', value]),
    onDragPreview: (value) => callbacks.push(['preview', value]),
    onDragCommit: (value) => callbacks.push(['commit', value]),
    onMapHold: (value) => callbacks.push(['hold', value]),
    ...(extra.direct === undefined ? { direct: () => true } : { direct: extra.direct }),
    dispatchGesture: (detail) => gestures.push(detail),
  });
  adapter.start();
  const emit = (name, value) => [...(handlers.get(`main:${name}`) ?? [])].forEach((listener) => listener(value, { requestId: 'r' }));
  const touch = (action, x, y, { gestureId = 7, pointerId = 0, pointerCount = 1, eventTime = 100, downTime = 100 } = {}) => ({
    gestureId, action, x, y, pointerCount, downTime, eventTime, pointers: [{ id: pointerId, x, y }],
  });
  const hit = ({ gestureId = 7, pointerId = 0, x = 10, y = 20, ids = ['track-node'], coordinate = [1, 2] } = {}) => ({
    gestureId, pointerId, downTime: 100, eventTime: 100, point: { x, y }, ids, coordinate,
  });
  return { adapter, callbacks, notices, gestures, emit, touch, hit, target };
}

test('native hit + real projection preserves FeatureDragBridge callback contract and captures camera', () => {
  const h = harness();
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit());
  assert.deepEqual(h.callbacks[0], ['begin', h.target]);
  assert.deepEqual(h.callbacks[1], ['preview', { target: h.target, coordinate: [1, 2] }]);
  assert.deepEqual(h.notices.map(({ command, payload }) => [command, payload]), [
    ['gestureCapture', { gestureId: 7, enabled: true }],
  ]);

  h.emit('touch', h.touch(2, 25, 40));
  h.emit('touch', h.touch(1, 25, 40, { eventTime: 180 }));
  assert.deepEqual(h.callbacks.at(-2), ['commit', { target: h.target, coordinate: [2.5, 4] }]);
  assert.deepEqual(h.callbacks.at(-1), ['preview', null]);
  assert.deepEqual(h.notices.at(-1), { mapId: 'main', command: 'gestureCapture', payload: { gestureId: 7, enabled: false } });
  assert.deepEqual(h.gestures.map(({ phase }) => phase), ['start', 'end']);
  h.adapter.dispose();
});

test('stale hit results are ignored and a second finger cancels preview without commit', () => {
  const h = harness();
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit({ gestureId: 6 }));
  assert.equal(h.callbacks.length, 0);
  h.emit('hitTest', h.hit());
  h.emit('touch', h.touch(2, 20, 30));
  h.emit('touch', h.touch(5, 20, 30, { pointerCount: 2, pointerId: 1 }));
  assert.equal(h.callbacks.some(([kind]) => kind === 'commit'), false);
  assert.deepEqual(h.callbacks.at(-1), ['preview', null]);
  assert.equal(h.notices.at(-1).payload.enabled, false);
  assert.deepEqual(h.gestures.at(-1).phase, 'cancel');
  h.adapter.dispose();
});

test('long press is correlated with the native gesture and uses real native ground coordinate', () => {
  const h = harness({ direct: () => false });
  h.emit('touch', h.touch(0, 40, 50, { gestureId: 8, pointerId: 3 }));
  h.emit('touch', h.touch(1, 40, 50, { gestureId: 8, pointerId: 3, eventTime: 800 }));
  h.emit('longPress', { gestureId: 8, pointerId: 3, x: 40, y: 50, coordinates: [12, 34] });
  h.emit('hitTest', h.hit({ gestureId: 8, pointerId: 3, x: 40, y: 50, ids: [], coordinate: [12, 34] }));
  assert.deepEqual(h.callbacks, [['hold', { coordinate: [12, 34], point: { x: 40, y: 50 } }]]);
  assert.equal(h.adapter.blocksClick(), true);
  assert.deepEqual(h.gestures.map(({ phase }) => phase), ['start', 'end']);
  h.adapter.dispose();
});

test('blocked native terrain unprojection never commits a fabricated drag coordinate', () => {
  const h = harness({ blockUnproject: true });
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit());
  h.emit('touch', h.touch(2, 30, 40));
  h.emit('touch', h.touch(1, 30, 40, { eventTime: 180 }));
  assert.equal(h.callbacks.some(([kind]) => kind === 'commit'), false);
  h.adapter.dispose();
});

test('dispose unsubscribes and releases an active native gesture capture', () => {
  const h = harness();
  h.emit('touch', h.touch(0, 10, 20)); h.emit('hitTest', h.hit());
  h.adapter.dispose();
  assert.equal(h.notices.at(-1).payload.enabled, false);
  h.emit('touch', h.touch(2, 20, 30));
  assert.deepEqual(h.callbacks.at(-1), ['preview', null]);
});
