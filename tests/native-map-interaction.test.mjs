import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeMapInteractionAdapter } from '../modules/map/native/interaction.ts';

function harness(extra = {}) {
  const handlers = new Map(), callbacks = [], notices = [], gestures = [], frames = new Map();
  let nextFrame = 1;
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
  const target = extra.target ?? { kind: 'track', node: { trackId: 'draft', coordinate: [1, 2] } };
  const adapter = new NativeMapInteractionAdapter({
    client,
    mapId: 'main',
    enabled: () => true,
    resolveTarget: (hit) => extra.resolveTarget ? extra.resolveTarget(hit) : hit.ids.includes(extra.hitId ?? 'track-node') ? target : null,
    onDragBegin: (value) => callbacks.push(['begin', value]),
    onDragPreview: (value) => callbacks.push(['preview', value]),
    onDragCommit: (value) => callbacks.push(['commit', value]),
    onMapHold: (value) => callbacks.push(['hold', value]),
    ...(extra.direct === undefined ? { direct: () => true } : { direct: extra.direct }),
    ...(extra.snap ? { snap: extra.snap } : {}),
    ...(extra.snapCoordinate ? { snapCoordinate: extra.snapCoordinate } : {}),
    dispatchGesture: (detail) => gestures.push(detail),
    requestFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
  });
  adapter.start();
  const emit = (name, value) => [...(handlers.get(`main:${name}`) ?? [])].forEach((listener) => listener(value, { requestId: 'r' }));
  const touch = (action, x, y, { gestureId = 7, pointerId = 0, pointerCount = 1, eventTime = 100, downTime = 100 } = {}) => ({
    gestureId, action, x, y, pointerCount, downTime, eventTime, pointers: [{ id: pointerId, x, y }],
  });
  const hit = ({ gestureId = 7, pointerId = 0, x = 10, y = 20, ids = ['track-node'], coordinate = [1, 2] } = {}) => ({
    gestureId, pointerId, downTime: 100, eventTime: 100, point: { x, y }, ids, coordinate,
  });
  const flushFrames = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(16));
  };
  return { adapter, callbacks, notices, gestures, emit, touch, hit, target, frames, flushFrames };
}

test('native editing network snap reaches preview and final commit without masquerading as a track node', () => {
  const calls = [];
  const h = harness({ snapCoordinate(target, point) {
    calls.push(point);
    return { coordinate: [point.x / 20, point.y / 20], hint: '已吸附道路 · 测试路' };
  } });
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit());
  h.emit('touch', h.touch(2, 40, 50));
  h.flushFrames();
  const preview = h.callbacks.filter(([type]) => type === 'preview').at(-1)[1];
  assert.deepEqual(preview.coordinate, [2, 2.5]);
  assert.equal(preview.snapHint, '已吸附道路 · 测试路');
  assert.equal(preview.snappedNode, undefined);
  h.emit('touch', h.touch(1, 60, 70));
  const committed = h.callbacks.find(([type]) => type === 'commit')[1];
  assert.deepEqual(committed.coordinate, [3, 3.5], 'UP recomputes at the real final location');
  assert.equal(committed.snappedNode, undefined);
  assert.deepEqual(calls, [{ x: 40, y: 50 }, { x: 60, y: 70 }]);
  h.adapter.dispose();
});

test('real node joins retain priority over network snapping', () => {
  const node = { trackId: 'other-saved-track', coordinate: [7, 8] };
  const h = harness({ snap: () => node, snapCoordinate() { assert.fail('network must not replace an actual node join'); } });
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit());
  h.emit('touch', h.touch(1, 40, 50));
  const committed = h.callbacks.find(([type]) => type === 'commit')[1];
  assert.equal(committed.snappedNode, node);
  assert.deepEqual(committed.coordinate, [7, 8]);
  assert.equal(committed.snapHint, undefined);
  h.adapter.dispose();
});

test('loading network data and turning snapping off during a drag commit the final raw ground position', () => {
  let enabled = true;
  const h = harness({ snapCoordinate: () => enabled ? { coordinate: null, hint: '道路数据加载中 · 暂按原始位置' } : null });
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit());
  h.emit('touch', h.touch(2, 40, 50));
  h.flushFrames();
  const preview = h.callbacks.filter(([type]) => type === 'preview').at(-1)[1];
  assert.deepEqual(preview.coordinate, [4, 5]);
  assert.match(preview.snapHint, /加载中/);
  enabled = false;
  h.emit('touch', h.touch(1, 60, 70));
  const committed = h.callbacks.find(([type]) => type === 'commit')[1];
  assert.deepEqual(committed.coordinate, [6, 7]);
  assert.equal(committed.snappedNode, undefined);
  assert.equal(committed.snapHint, undefined);
  h.adapter.dispose();
});

test('native hit parsing preserves exact GPU IDs separately from expanded candidates for drag resolution', () => {
  const seen=[];
  const h=harness({resolveTarget:hit=>{seen.push(hit);return null;}});
  h.emit('touch',h.touch(0,10,20));
  h.emit('hitTest',{...h.hit({ids:['shantu-object:a','shantu-object:b']}),exactIds:['shantu-object:b']});
  assert.deepEqual(seen[0].ids,['shantu-object:a','shantu-object:b']);
  assert.deepEqual(seen[0].exactIds,['shantu-object:b']);
  h.adapter.dispose();
});

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

test('native node and annotation drags consume only the latest MOVE once per animation frame', () => {
  const cases = [
    { name: 'node', target: { kind: 'track', node: { trackId: 'draft', coordinate: [1, 2] } }, hitId: 'track-node', down: [10, 20], moves: [[20, 30], [35, 45], [50, 60]], expected: [5, 6] },
    { name: 'annotation', target: { kind: 'annotation', id: 'pin-a', coordinate: [3, 4] }, hitId: 'annotation', down: [30, 40], moves: [[40, 50], [55, 65], [80, 90]], expected: [8, 9] },
  ];
  for (const item of cases) {
    const h = harness({ target: item.target, hitId: item.hitId });
    h.emit('touch', h.touch(0, ...item.down));
    h.emit('hitTest', h.hit({ x: item.down[0], y: item.down[1], coordinate: item.target.kind === 'track' ? item.target.node.coordinate : item.target.coordinate, ids: [item.hitId] }));
    for (const [x, y] of item.moves) h.emit('touch', h.touch(2, x, y));
    assert.equal(h.callbacks.filter(([kind]) => kind === 'preview').length, 1,
      `${item.name}: intermediate MOVE callbacks should wait for the frame`);
    assert.equal(h.frames.size, 1, `${item.name}: multiple MOVE events schedule one frame`);
    h.flushFrames();
    const previews = h.callbacks.filter(([kind, value]) => kind === 'preview' && value);
    assert.equal(previews.length, 2, `${item.name}: only one preview is consumed for the frame`);
    assert.deepEqual(previews.at(-1)[1].coordinate, item.expected, `${item.name}: use the newest MOVE coordinate`);
    h.adapter.dispose();
  }
});

test('native ACTION_UP flushes its final point synchronously before one commit', () => {
  const h = harness();
  h.emit('touch', h.touch(0, 10, 20));
  h.emit('hitTest', h.hit());
  h.emit('touch', h.touch(2, 25, 40));
  assert.equal(h.frames.size, 1);
  h.emit('touch', h.touch(1, 40, 50, { eventTime: 180 }));
  const finalPreview = h.callbacks.findIndex(([kind, move]) => kind === 'preview' && move?.coordinate[0] === 4 && move?.coordinate[1] === 5);
  const commit = h.callbacks.findIndex(([kind, move]) => kind === 'commit' && move?.coordinate[0] === 4 && move?.coordinate[1] === 5);
  assert.ok(finalPreview >= 0 && finalPreview < commit, 'the final ACTION_UP point is previewed before commit');
  assert.equal(h.callbacks.filter(([kind]) => kind === 'commit').length, 1);
  assert.equal(h.frames.size, 0, 'the queued frame is canceled when the final point is flushed');
  h.flushFrames();
  assert.equal(h.callbacks.filter(([kind]) => kind === 'commit').length, 1, 'no late frame can commit a second time');
  h.adapter.dispose();
});

test('native cancellation and dispose discard queued MOVE work without late preview or commit', () => {
  for (const endWithDispose of [false, true]) {
    const h = harness();
    h.emit('touch', h.touch(0, 10, 20));
    h.emit('hitTest', h.hit());
    h.emit('touch', h.touch(2, 30, 40));
    assert.equal(h.frames.size, 1);
    if (endWithDispose) h.adapter.dispose();
    else h.emit('touch', h.touch(3, 30, 40));
    const previewsAtEnd = h.callbacks.filter(([kind]) => kind === 'preview').length;
    h.flushFrames();
    assert.equal(h.callbacks.filter(([kind]) => kind === 'preview').length, previewsAtEnd);
    assert.equal(h.callbacks.some(([kind]) => kind === 'commit'), false);
    if (!endWithDispose) h.adapter.dispose();
  }
});

test('ordinary taps and pans never schedule drag preview frames', () => {
  const tap = harness({ direct: () => false });
  tap.emit('touch', tap.touch(0, 10, 20));
  tap.emit('hitTest', tap.hit());
  tap.emit('touch', tap.touch(1, 10, 20, { eventTime: 140 }));
  assert.equal(tap.frames.size, 0);
  assert.equal(tap.callbacks.length, 0);
  tap.adapter.dispose();

  const pan = harness({ direct: () => false });
  pan.emit('touch', pan.touch(0, 10, 20));
  pan.emit('hitTest', pan.hit());
  pan.emit('touch', pan.touch(2, 21, 30));
  assert.equal(pan.frames.size, 0);
  assert.equal(pan.callbacks.some(([kind]) => kind === 'preview' || kind === 'commit'), false);
  pan.adapter.dispose();
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
