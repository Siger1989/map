import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/markerLayoutCache.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { MarkerLayoutCache } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fakeElement(rect, { transform = 'none', offsetWidth = rect.width, offsetHeight = rect.height,
  children = [], pseudoBorder = '0px', computedRectReads = { count: 0 } } = {}) {
  const style = { transform, rotate: 'none', scale: 'none', transformOrigin: '0px 0px',
    display: 'block', visibility: 'visible', content: 'normal',
    borderTopWidth: pseudoBorder, borderRightWidth: pseudoBorder,
    borderBottomWidth: pseudoBorder, borderLeftWidth: pseudoBorder };
  const element = {
    ownerDocument: { defaultView: { getComputedStyle: (_el, pseudo) => pseudo ? { ...style, content: '"x"' } : style } },
    style,
    offsetWidth, offsetHeight,
    children,
    getBoundingClientRect() { computedRectReads.count++; return { ...rect }; },
    getClientRects() { return rect.width || rect.height ? [{}] : []; },
    querySelectorAll() { return children; },
  };
  return element;
}

function measure(marker, root) {
  const child = marker.children[0];
  const childRect = child?.getBoundingClientRect() ?? root;
  return { visualBounds: { left: childRect.left - 12, top: childRect.top - 12,
    right: childRect.right + 12, bottom: childRect.bottom + 12 },
  targets: [child ?? marker], targetMetrics: [{ left: childRect.left, top: childRect.top,
    right: childRect.right, bottom: childRect.bottom, width: childRect.width, height: childRect.height,
    offsetWidth: child?.offsetWidth ?? marker.offsetWidth, offsetHeight: child?.offsetHeight ?? marker.offsetHeight }] };
}

test('translation repositions cached visual bounds and target metrics using one root rect read', () => {
  const rootReads = { count: 0 }, childReads = { count: 0 };
  const child = fakeElement({ left: 110, top: 120, right: 130, bottom: 140, width: 20, height: 20 },
    { offsetWidth: 10, offsetHeight: 10, computedRectReads: childReads });
  const rootRect = { left: 100, top: 100, right: 140, bottom: 150, width: 40, height: 50 };
  const root = fakeElement(rootRect, { children: [child], computedRectReads: rootReads });
  let measures = 0;
  const cache = new MarkerLayoutCache((marker, rect) => { measures++; return measure(marker, rect); });

  const first = cache.get(root);
  rootRect.left += 25; rootRect.right += 25; rootRect.top -= 8; rootRect.bottom -= 8;
  const second = cache.get(root);
  assert.equal(measures, 1);
  assert.deepEqual(second.visualBounds, { left: first.visualBounds.left + 25, top: first.visualBounds.top - 8,
    right: first.visualBounds.right + 25, bottom: first.visualBounds.bottom - 8 });
  assert.deepEqual(second.targetMetrics[0], { ...first.targetMetrics[0], left: first.targetMetrics[0].left + 25,
    right: first.targetMetrics[0].right + 25, top: first.targetMetrics[0].top - 8,
    bottom: first.targetMetrics[0].bottom - 8 });
  assert.equal(second.targetMetrics[0].offsetWidth, 10);
  assert.equal(second.targets[0], child);
  assert.equal(rootReads.count, 2, 'the cache hit reads only the root rectangle');
  assert.equal(childReads.count, 1, 'the cache hit does not re-read descendant geometry');
  assert.deepEqual(second.observedElements, [root, child]);
  assert.deepEqual(cache.observedElements, [root, child]);
});

test('root dimensions and non-translation transform changes trigger a fresh deep read', () => {
  const child = fakeElement({ left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20 });
  const rect = { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 };
  const root = fakeElement(rect, { children: [child], transform: 'matrix(1, 0, 0, 1, 0, 0)' });
  let measures = 0;
  const cache = new MarkerLayoutCache((marker, rootRect) => { measures++; return measure(marker, rootRect); });
  cache.get(root);
  root.style.transform = 'matrix(1, 0, 0, 1, 12, 4)'; // translation is ignored
  cache.get(root);
  assert.equal(measures, 1);
  rect.right = 60; rect.width = 60;
  cache.get(root);
  assert.equal(measures, 2);
  root.style.transform = 'matrix(0, 1, -1, 0, 12, 4)'; // quarter-turn changes relative geometry
  cache.get(root);
  assert.equal(measures, 3);
});

test('explicit invalidation, clear, and zero-size roots retain overflowing descendant and pseudo bounds', () => {
  const childRect = { left: 220, top: 330, right: 250, bottom: 360, width: 30, height: 30 };
  const child = fakeElement(childRect, { pseudoBorder: '20px' });
  const rootRect = { left: 200, top: 300, right: 200, bottom: 300, width: 0, height: 0 };
  const root = fakeElement(rootRect, { children: [child] });
  let measures = 0;
  const cache = new MarkerLayoutCache((marker, rect) => { measures++; return { visualBounds: null,
    targets: [marker.children[0]], targetMetrics: [] }; });
  const entry = cache.get(root);
  assert.deepEqual(entry.visualBounds, { left: 197, top: 300, right: 273, bottom: 383 });
  assert.equal(measures, 1);
  cache.invalidate(root);
  cache.get(root);
  assert.equal(measures, 2);
  cache.clear();
  assert.deepEqual(cache.observedElements, []);
  cache.get(root);
  assert.equal(measures, 3);
});
