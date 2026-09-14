import test from 'node:test';
import assert from 'node:assert/strict';
import {
  breadcrumbReturn,
  returnBearing,
} from '../modules/returnHome/breadcrumbs.ts';
test('breadcrumb return preserves loops, selects one pause section and leaves source intact', () => {
  const lines = [
    [
      [104, 30],
      [104.001, 30],
    ],
    [
      [104.002, 30],
      [104.003, 30],
      [104.003, 30.001],
      [104.003, 30],
      [104.004, 30],
    ],
  ];
  const before = structuredClone(lines),
    route = breadcrumbReturn('record', lines).route;
  assert.deepEqual(route.coordinates, [...lines[1]].reverse());
  assert.deepEqual(route.preferredTrackPath, route.coordinates);
  assert.deepEqual(lines, before);
  assert.throws(() => breadcrumbReturn('x', [[[104, 30]]]), /不足/);
  assert.equal(Math.round(returnBearing([104, 30], [104, 31])), 0);
});
