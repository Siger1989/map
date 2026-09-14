import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  captureAnchor,
  anchorPosition,
  referenceFrame,
  anchorBatchTargets,
  rebaseChildAnchors,
} from '../modules/uiLayout/anchors.mjs';
import { batchPatches, bounds } from '../modules/uiLayout/geometry.mjs';
import { emptyLayout, validateLayout } from '../modules/uiLayout/model.mjs';
import { defaults } from '../modules/uiLayout/selection.mjs';

const box = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const frame = (width, height) => ({
  rect: box(0, 0, width, height),
  scale: { x: 1, y: 1 },
});
test('all four screen edges retain their distances when the viewport and component sizes change', () => {
  for (const [x, y] of [
    ['left', 'top'],
    ['right', 'top'],
    ['left', 'bottom'],
    ['right', 'bottom'],
  ]) {
    const anchor = { reference: 'viewport', x, y, gapX: 8, gapY: 12 };
    for (const [width, height] of [
      [390, 844],
      [360, 780],
      [430, 932],
    ]) {
      const p = anchorPosition(anchor, frame(width, height), {
        width: 32,
        height: 40,
      });
      assert.equal(x === 'left' ? p.left : width - p.left - 32, 8);
      assert.equal(y === 'top' ? p.top : height - p.top - 40, 12);
    }
  }
});

test('centre offsets and parent-relative margins scale with the parent, not with the child', () => {
  const anchor = {
    reference: '.group',
    x: 'center',
    y: 'bottom',
    gapX: 0,
    gapY: 4,
  };
  assert.deepEqual(
    anchorPosition(
      anchor,
      { rect: box(100, 200, 120, 80), scale: { x: 0.5, y: 0.5 } },
      { width: 20, height: 10 },
    ),
    { left: 150, top: 268 },
  );
  assert.deepEqual(
    anchorPosition(
      anchor,
      { rect: box(100, 200, 240, 160), scale: { x: 1, y: 1 } },
      { width: 40, height: 20 },
    ),
    { left: 200, top: 336 },
  );
});

test('automatic anchors distinguish a fixed overlay from an internal control and honour safe insets', () => {
  const { document, window } = parseHTML(
    '<html><body><main class="observatory"><nav class="group"><button>按钮</button><aside>浮窗</aside></nav></main></body></html>',
  );
  window.innerWidth = 390;
  window.innerHeight = 844;
  window.CSS = { escape: (s) => s };
  window.getComputedStyle = (el) => ({
    position: el.localName === 'aside' ? 'fixed' : 'static',
    scale: 'none',
    transform: 'none',
    translate: 'none',
    zoom: '1',
    paddingTop: '20px',
    paddingBottom: '10px',
    paddingLeft: '0px',
    paddingRight: '0px',
  });
  const group = document.querySelector('.group');
  group.getBoundingClientRect = () => box(100, 200, 100, 100);
  const button = document.querySelector('button');
  button.getBoundingClientRect = () => box(102, 202, 30, 30);
  const overlay = document.querySelector('aside');
  overlay.getBoundingClientRect = () => box(350, 24, 32, 50);
  assert.equal(referenceFrame(button).reference, '.group');
  assert.deepEqual(captureAnchor(button), {
    reference: '.group',
    x: 'left',
    y: 'top',
    gapX: 2,
    gapY: 2,
  });
  assert.deepEqual(captureAnchor(overlay), {
    reference: 'viewport',
    x: 'right',
    y: 'top',
    gapX: 8,
    gapY: 4,
  });
});

test('optional anchoring round-trips alongside legacy layouts and rejects invalid edge metadata', () => {
  const legacy = { ...emptyLayout(), entries: [defaults('.group', '组')] };
  assert.equal(validateLayout(legacy).entries[0].anchor, undefined);
  const anchor = {
    reference: 'viewport',
    x: 'right',
    y: 'bottom',
    gapX: 8,
    gapY: 12,
  };
  const next = { ...legacy, entries: [{ ...legacy.entries[0], anchor }] };
  assert.deepEqual(validateLayout(next).entries[0].anchor, anchor);
  for (const bad of [
    { ...anchor, x: 'invalid' },
    { ...anchor, gapX: Infinity },
    { ...anchor, reference: 'body{display:none}' },
  ])
    assert.throws(() =>
      validateLayout({
        ...legacy,
        entries: [{ ...legacy.entries[0], anchor: bad }],
      }),
    );
});

test('multi-selection retains a common right edge while scaling member spacing', () => {
  const { document, window } = parseHTML(
    '<html><body><nav></nav><nav></nav></body></html>',
  );
  window.innerWidth = 390;
  window.innerHeight = 844;
  window.getComputedStyle = () => ({});
  const items = [...document.querySelectorAll('nav')].map((element, i) => ({
    element,
    entry: defaults(`nav:nth-child(${i + 1})`, '工具'),
    rect: i ? box(342, 180, 40, 40) : box(332, 100, 50, 50),
    box: { width: i ? 40 : 50, height: i ? 40 : 50 },
    parentScale: { x: 1, y: 1 },
    ownScale: { x: 1, y: 1 },
  }));
  const group = bounds(items),
    patch = { scale: 0.8 },
    changes = batchPatches(items, group, patch);
  anchorBatchTargets(items, group, patch, changes);
  assert.equal(changes[0].target.left + 40, 382);
  assert.equal(changes[1].target.left + 32, 382);
  assert.equal(changes[1].target.top - changes[0].target.top, 64);
});

test('editing a parent rebases independent child anchors without reparenting or changing stored geometry', () => {
  const { document, window } = parseHTML(
    '<html><body><nav class="group"><button id="child">按钮</button></nav></body></html>',
  );
  window.CSS = { escape: (s) => s };
  window.getComputedStyle = () => ({
    scale: 'none',
    transform: 'none',
    zoom: '1',
  });
  const parent = document.querySelector('.group'),
    child = document.querySelector('#child');
  parent.getBoundingClientRect = () => box(100, 200, 200, 100);
  child.getBoundingClientRect = () => box(120, 210, 50, 20);
  const entry = {
    ...defaults('#child', '按钮'),
    dx: 5,
    anchor: {
      reference: 'viewport',
      x: 'left',
      y: 'top',
      gapX: 120,
      gapY: 210,
    },
  };
  const next = rebaseChildAnchors(document, [entry], [{ element: parent }])[0];
  assert.deepEqual(next.anchor, {
    reference: '.group',
    x: 'left',
    y: 'top',
    gapX: 20,
    gapY: 10,
  });
  assert.equal(next.dx, 5);
  assert.equal(child.parentElement, parent);
  assert.equal(entry.anchor.reference, 'viewport');
});
