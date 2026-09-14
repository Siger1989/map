import test from 'node:test';
import assert from 'node:assert/strict';
import { dragPatch, alignPatch } from '../tools/layout-editor/geometry.mjs';
const entry = { dx: 12, dy: -8, scale: 0.8 };

test('dragging a child of a scaled group uses parent CSS pixels and keeps bounded offsets', () => {
  assert.deepEqual(
    dragPatch({ entry, parentScale: { x: 0.5, y: 0.5 } }, { x: 20, y: -10 }),
    { dx: 52, dy: -28 },
  );
  assert.deepEqual(dragPatch({ entry }, { x: 10000, y: -10000 }), {
    dx: 3000,
    dy: -3000,
  });
  assert.deepEqual(dragPatch({ entry }, { x: 5, y: 5 }, { snap: true }), {
    dx: 16,
    dy: -4,
  });
});

test('resize handles honour nested scale and preserve the opposite top/left edge', () => {
  const start = {
    entry,
    box: { width: 200, height: 100 },
    parentScale: { x: 0.5, y: 0.5 },
    ownScale: { x: 0.8, y: 0.8 },
    handle: 'se',
  };
  assert.deepEqual(dragPatch(start, { x: 20, y: 12 }), {
    width: 250,
    height: 130,
    dx: 12,
    dy: -8,
  });
  assert.deepEqual(dragPatch({ ...start, handle: 'nw' }, { x: 20, y: 12 }), {
    width: 150,
    height: 70,
    dx: 52,
    dy: 16,
  });
  assert.deepEqual(
    dragPatch({ ...start, handle: 'e' }, { x: 20, y: 12 }, { ratio: true }),
    { width: 250, height: 100, dx: 12, dy: -8 },
  );
});

test('corner ratio lock can both enlarge and shrink with a mostly horizontal gesture', () => {
  const start = {
    entry: { ...entry, scale: 1 },
    box: { width: 200, height: 100 },
    handle: 'se',
  };
  assert.deepEqual(dragPatch(start, { x: 100, y: 0 }, { ratio: true }), {
    width: 300,
    height: 150,
    dx: 12,
    dy: -8,
  });
  assert.deepEqual(dragPatch(start, { x: -40, y: 0 }, { ratio: true }), {
    width: 160,
    height: 80,
    dx: 12,
    dy: -8,
  });
  const bounded = dragPatch(start, { x: -10000, y: -10000 }, { ratio: true });
  assert.equal(bounded.width, 16);
  assert.equal(bounded.height, 16);
});

test('alignment and recovery bring an offscreen scaled control into the phone viewport', () => {
  const rect = { left: 400, top: -200, width: 100, height: 60 },
    viewport = { width: 390, height: 844 };
  const result = alignPatch(entry, rect, viewport, 'recover', {
    x: 0.5,
    y: 0.5,
  });
  assert.equal(rect.left + (result.dx - entry.dx) * 0.5, 145);
  assert.equal(rect.top + (result.dy - entry.dy) * 0.5, 392);
  assert.equal(alignPatch(entry, rect, viewport, 'right').dx, -102);
  assert.equal(alignPatch(entry, rect, viewport, 'left').dy, entry.dy);
});
