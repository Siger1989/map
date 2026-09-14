import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeDrag } from '../modules/uiLayout/resize.mjs';
import { batchPatches } from '../modules/uiLayout/geometry.mjs';
import { bindGestures } from '../modules/uiLayout/gestures.mjs';
import { parseHTML } from 'linkedom';

const start = (handle) => ({
  handle,
  entry: { dx: 12, dy: 8, scale: 0.8 },
  box: { width: 100, height: 50 },
  parentScale: { x: 0.5, y: 0.5 },
  ownScale: { x: 0.8, y: 0.8 },
  rect: { left: 100, right: 140, top: 60, bottom: 80, width: 40, height: 20 },
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('resize gestures retain pointer displacement and explicitly bypass numeric edge anchoring', () => {
  const { document: doc, window } = parseHTML(
    '<html><body><div id="cover"><button data-resize="w"></button></div></body></html>',
  );
  window.innerWidth = 390;
  window.innerHeight = 844;
  const cover = doc.getElementById('cover'),
    handle = cover.querySelector('button'),
    g = start('w'),
    calls = [];
  cover.focus = () => {};
  cover.setPointerCapture = () => {};
  let checkpoints = 0;
  bindGestures({
    cover,
    zoom: () => 1,
    operating: () => false,
    document: () => doc,
    selectedNode: () => handle,
    targets: () => [g],
    multiple: () => false,
    contains: () => true,
    entry: () => g.entry,
    select: () => {},
    granularity: () => 'component',
    checkpoint: () => checkpoints++,
    update: () => assert.fail('resize must use batch geometry'),
    updateBatch: (...args) => calls.push(args),
    syncPanels: () => {},
    status: () => {},
    snap: () => false,
    ratio: () => true,
    interaction: () => 'resize',
    guides: () => false,
  });
  cover.onpointerdown({
    button: 0,
    target: handle,
    clientX: 100,
    clientY: 60,
    pointerId: 1,
    preventDefault: () => {},
  });
  cover.onpointerup({ type: 'pointerup', clientX: 104, clientY: 60 });
  assert.equal(checkpoints, 1);
  assert.equal(calls.length, 1);
  close(calls[0][2].dx, 4);
  close(calls[0][2].scale, 0.9);
  assert.equal(calls[0][5], 'pointer');
});
test('pointer resizing all eight handles preserves opposite edges through ancestor scale', () => {
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const g = start(handle),
      delta = {
        x: handle.includes('w') ? 4 : handle.includes('e') ? -4 : 0,
        y: handle.includes('n') ? 2 : handle.includes('s') ? -2 : 0,
      };
    const { patch } = resizeDrag(g, delta, {
      contentScale: true,
      guides: false,
    });
    close(patch.scale, 0.9);
    close(patch.dx, handle.includes('w') ? 4 : 0);
    close(patch.dy, handle.includes('n') ? 2 : 0);
    const [change] = batchPatches([g], g.rect, patch);
    close(change.target.left, 100 + patch.dx);
    close(change.next.dx, 12 + patch.dx / 0.5);
  }
});
test('frame-only pointer resizing converts rendered dimensions back into unscaled CSS dimensions', () => {
  const g = start('w'),
    { patch } = resizeDrag(g, { x: 4, y: 0 }, { guides: false });
  close(patch.width, 36);
  close(patch.height, 20);
  close(patch.dx, 4);
  const [change] = batchPatches([g], g.rect, patch);
  close(change.next.width, 90);
  close(change.next.height, 50);
});
test('resize guides align the moving edge without snapping an already aligned stationary edge', () => {
  const g = {
    ...start('w'),
    rect: {
      left: 100,
      right: 200,
      top: 100,
      bottom: 150,
      width: 100,
      height: 50,
    },
    box: { width: 100, height: 50 },
    parentScale: { x: 1, y: 1 },
    ownScale: { x: 1, y: 1 },
    entry: { dx: 0, dy: 0, scale: 1 },
  };
  const options = {
    contentScale: true,
    viewport: { width: 600, height: 800 },
    peers: [{ left: 82, right: 120, top: 250, bottom: 300 }],
  };
  const resized = resizeDrag(g, { x: -15, y: 0 }, options);
  close(resized.patch.dx, -18);
  close(resized.patch.scale, 1.18);
  assert.deepEqual(
    resized.lines.map((l) => [l.axis, l.position]),
    [['x', 82]],
  );
  const unaligned = resizeDrag(
    g,
    { x: 15, y: 0 },
    { ...options, peers: [{ left: 200, right: 240, top: 100, bottom: 150 }] },
  );
  assert.equal(unaligned.lines.length, 0);
  close(unaligned.patch.dx, 15);
});
test('corner guide snapping keeps a common ratio and size limits do not show unreachable guides', () => {
  const g = {
    ...start('nw'),
    rect: {
      left: 100,
      right: 200,
      top: 100,
      bottom: 150,
      width: 100,
      height: 50,
    },
    box: { width: 100, height: 50 },
    parentScale: { x: 1, y: 1 },
    ownScale: { x: 1, y: 1 },
    entry: { dx: 0, dy: 0, scale: 1 },
  };
  const result = resizeDrag(
    g,
    { x: -15, y: -7 },
    {
      contentScale: true,
      viewport: { width: 600, height: 800 },
      peers: [{ left: 82, right: 182, top: 91, bottom: 171 }],
    },
  );
  close(result.patch.scale, 1.18);
  close(result.patch.dx, -18);
  close(result.patch.dy, -9);
  const capped = resizeDrag(
    { ...g, scaleLimits: { min: 1, max: 1.15 } },
    { x: -15, y: -7 },
    {
      contentScale: true,
      viewport: { width: 600, height: 800 },
      peers: [{ left: 82, right: 84, top: 20, bottom: 30 }],
    },
  );
  close(capped.patch.scale, 1.15);
  assert.equal(capped.lines.length, 0);
});
