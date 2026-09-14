import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLayout,
  validateLayout,
  layoutCss,
} from '../tools/layout-editor/model.mjs';
const sample = () => ({
  ...emptyLayout(),
  entries: [
    {
      selector: '.position-dock',
      label: '定位组件',
      dx: 12,
      dy: -8,
      scale: 0.8,
      width: 100,
      height: null,
      fontSize: 11,
      hidden: false,
    },
  ],
});
test('layout JSON round-trips only supported fields and preserves adaptive dimensions', () => {
  const input = sample();
  input.entries[0].unknown = 'discard';
  const value = validateLayout(JSON.parse(JSON.stringify(input)));
  assert.equal(value.entries[0].unknown, undefined);
  assert.equal(value.entries[0].height, null);
  assert.match(layoutCss(value), /translate:12px -8px/);
  assert.match(layoutCss(value), /width:100px/);
  assert.doesNotMatch(layoutCss(value), /height:/);
  assert.deepEqual(validateLayout(emptyLayout()), emptyLayout());
});
test('invalid layout cannot inject style blocks or duplicate conflicting controls', () => {
  for (const patch of [
    { dx: NaN },
    { scale: -1 },
    { width: 0 },
    { hidden: 'yes' },
    { selector: 'a}body{display:none' },
  ]) {
    const value = sample();
    Object.assign(value.entries[0], patch);
    assert.throws(() => validateLayout(value));
  }
  const value = sample();
  value.entries.push({ ...value.entries[0] });
  assert.throws(() => validateLayout(value));
  assert.throws(() => validateLayout({ ...emptyLayout(), version: 9 }));
  assert.throws(() =>
    validateLayout({ ...emptyLayout(), viewport: { width: 0, height: 844 } }),
  );
});

test('child component selectors remain valid for independent bottom controls', () => {
  const v = sample();
  v.entries[0].selector = '.position-dock > .position-dock-button';
  assert.match(layoutCss(v), /position-dock > /);
});

test('font and layer changes do not create a transformed parent for fixed-position children', () => {
  const value = sample();
  Object.assign(value.entries[0], {
    dx: 0,
    dy: 0,
    scale: 1,
    width: null,
    zIndex: 201,
  });
  const css = layoutCss(value);
  assert.match(css, /z-index:201!important/);
  assert.match(css, /shantu-layout-priority#shantu-layout-priority/);
  assert.doesNotMatch(css, /translate:|scale:|transform-origin:/);
  assert.equal(validateLayout(value).entries[0].zIndex, 201);
  value.entries[0].zIndex = Infinity;
  assert.throws(() => validateLayout(value));
});
