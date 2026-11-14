import assert from 'node:assert/strict';
import test from 'node:test';
import { mapScaleMaxWidth, mapScalePlacement } from '../modules/map/mapScaleLayout.ts';
import { makeMapScaleMark } from '../modules/map/native/scale.ts';

const role = (...classes) => ({ classList: { contains: name => classes.includes(name) } });
test('main uses a real 44px sampled span while each comparison viewport retains 72px', () => {
  assert.equal(mapScaleMaxWidth(role('map-canvas')), 44);
  assert.equal(mapScaleMaxWidth(role('map-canvas', 'map-comparison-primary')), 72);
  assert.equal(mapScaleMaxWidth(role('map-canvas', 'map-comparison-secondary')), 72);
  const main = makeMapScaleMark(327, mapScaleMaxWidth(role('map-canvas')));
  assert.equal(main.label, '200 m');
  assert.equal(main.width, 44 * 200 / 327);
  assert.ok(main.width < 44);
});

test('390 and 360 main viewports anchor below the actual upper action rail, not the lower route panel', () => {
  for (const width of [390, 360]) {
    const map = { left: 0, top: 0, right: width, bottom: 857, width, height: 857 };
    const actions = { left: width - 58, right: width - 8, top: 58, bottom: 160, width: 50, height: 102 };
    assert.deepEqual(mapScalePlacement(map, actions, width, 857), { top: 168, right: 11 });
    assert.deepEqual(mapScalePlacement(map, { ...actions, bottom: 180, height: 122 }, width, 857), { top: 188, right: 11 });
  }
});

test('actual bounds account for preview scaling and safe-area viewport origins', () => {
  const map = { left: 20, top: 30, right: 215, bottom: 458.5, width: 195, height: 428.5 };
  const actions = { left: 186, right: 211, top: 59, bottom: 110, width: 25, height: 51 };
  assert.deepEqual(mapScalePlacement(map, actions, 390, 857), { top: 168, right: 11 });
  assert.equal(mapScalePlacement(map, { ...actions, height: 0 }, 390, 857), null);
});
