import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  dragPatch,
  bounds,
  batchPatches,
  dimensionScalePatch,
  fontMetrics,
  fontSizePatches,
} from '../modules/uiLayout/geometry.mjs';
import { alignFrame } from '../modules/uiLayout/alignment.mjs';
import { layerPatches } from '../modules/uiLayout/layers.mjs';
import { defaults } from '../modules/uiLayout/selection.mjs';
import { isLayoutInteraction } from '../modules/uiLayout/events.ts';

const item = (scale = 1, left = 0) => ({
  entry: { ...defaults('.panel', '面板'), scale },
  box: { width: 100, height: 50 },
  rect: {
    left,
    top: 0,
    right: left + 100 * scale,
    bottom: 50 * scale,
    width: 100 * scale,
    height: 50 * scale,
  },
  parentScale: { x: 1, y: 1 },
  ownScale: { x: scale, y: scale },
});

test('all eight size handles scale content, preserve layout dimensions and anchor the opposite edge', () => {
  for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const start = { ...item(0.8), handle, parentScale: { x: 0.5, y: 0.5 } };
    const horizontal = /[ew]/.test(handle);
    const patch = dragPatch(
      start,
      {
        x: horizontal ? (handle.includes('w') ? 4 : -4) : 0,
        y: horizontal ? 0 : handle === 'n' ? 2 : -2,
      },
      { contentScale: true },
    );
    assert.ok(Math.abs(patch.scale - 0.72) < 1e-9, handle);
    assert.equal(patch.width, undefined);
    assert.equal(patch.height, undefined);
    assert.ok(Math.abs(patch.dx - (handle.includes('w') ? 8 : 0)) < 1e-9);
    assert.ok(Math.abs(patch.dy - (handle.includes('n') ? 4 : 0)) < 1e-9);
  }
});

test('numeric width and height use displayed bounds; group scale limits preserve spacing and ratios', () => {
  const items = [item(0.5), item(2, 200)],
    frame = bounds(items);
  assert.deepEqual(dimensionScalePatch(items, 'width', frame.width * 0.5), {
    scale: 0.8,
  });
  assert.deepEqual(dimensionScalePatch(items, 'height', frame.height * 2), {
    scale: 1.25,
  });
  const changes = batchPatches(items, frame, { scale: 0.1 });
  assert.equal(changes[0].next.scale, 0.4);
  assert.equal(changes[1].next.scale, 1.6);
  assert.equal(changes[1].target.left, 160);
  assert.throws(() => dimensionScalePatch(items, 'width', NaN));
});

test('displayed font size accounts for parent and component scale and round-trips local CSS size', () => {
  const target = {
    ...item(0.8),
    parentScale: { x: 0.5, y: 0.5 },
    element: {
      ownerDocument: {
        defaultView: { getComputedStyle: () => ({ fontSize: '20px' }) },
      },
    },
  };
  assert.equal(fontMetrics([target]).pixels, 8);
  assert.equal(fontSizePatches([target], 9.6)[0].fontSize, 23.999999999999996);
  assert.equal(fontSizePatches([target], null)[0].fontSize, null);
  assert.throws(() => fontSizePatches([target], 200));
});

test('guides snap nearest peer edges and centres, but release beyond the threshold', () => {
  const viewport = { width: 390, height: 844 };
  const peer = { left: 100, right: 200, top: 300, bottom: 340 };
  const moving = { left: 103, right: 163, top: 400, bottom: 430 };
  const aligned = alignFrame(moving, [peer], viewport);
  assert.equal(aligned.delta.x, -3);
  assert.equal(aligned.lines[0].position, 100);
  assert.equal(
    alignFrame({ ...moving, left: 126, right: 186 }, [peer], viewport).delta.x,
    -6,
  );
  assert.equal(
    alignFrame(
      { left: 115, right: 175, top: 500, bottom: 530 },
      [peer],
      viewport,
      3,
    ).lines.length,
    0,
  );
});

test('guides include viewport safe edges and centre without any other UI', () => {
  const viewport = { width: 390, height: 844 };
  assert.equal(
    alignFrame({ left: 7, right: 57, top: 100, bottom: 130 }, [], viewport)
      .delta.x,
    -3,
  );
  assert.equal(
    alignFrame({ left: 173, right: 223, top: 100, bottom: 130 }, [], viewport)
      .delta.x,
    -3,
  );
});

test('layer stepping crosses the nearest sibling level, skips editor UI and retains geometry', () => {
  const { document, window } = parseHTML(
    '<html><body><main><nav id="a"></nav><nav id="b"></nav><nav id="c"></nav><aside data-layout-ignore></aside></main></body></html>',
  );
  const z = { a: 20, b: 40, c: 10 };
  window.getComputedStyle = (node) => ({ zIndex: String(z[node.id] ?? 9999) });
  for (const node of document.querySelectorAll('*'))
    node.getBoundingClientRect = () => ({ width: 30, height: 30 });
  const target = {
    element: document.getElementById('a'),
    entry: { ...defaults('#a', '工具'), dx: 18, scale: 0.8 },
  };
  assert.equal(layerPatches([target], 1)[0].zIndex, 41);
  assert.equal(layerPatches([target], -1)[0].zIndex, 9);
  assert.equal(layerPatches([target], 1)[0].dx, 18);
  assert.equal(layerPatches([target], 1)[0].scale, 0.8);
});

test('layout entry and toolbar pointer paths preserve panels; normal outside clicks still dismiss', () => {
  const { document, window } = parseHTML(
    '<html><body><button data-layout-entry><span>布局</span></button><section data-layout-ignore><input></section><div id="map"></div></body></html>',
  );
  const previous = globalThis.Element;
  globalThis.Element = window.Element;
  try {
    const path = (selector) => {
      const node = document.querySelector(selector);
      return { composedPath: () => [node, node.parentElement, document.body] };
    };
    assert.equal(isLayoutInteraction(path('span')), true);
    assert.equal(isLayoutInteraction(path('input')), true);
    assert.equal(isLayoutInteraction(path('#map')), false);
  } finally {
    globalThis.Element = previous;
  }
});
