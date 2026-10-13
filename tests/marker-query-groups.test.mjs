import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/markerQueryGroups.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { groupMarkerQueries } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const item = (id, bounds) => ({ element: { id }, bounds });
const viewport = { left: 0, top: 0, right: 100, bottom: 100 };

test('transitively merges overlapping A-B-C bounds even when A and C do not directly overlap', () => {
  const a = item('A', { left: 5, top: 5, right: 20, bottom: 20 });
  const b = item('B', { left: 18, top: 8, right: 35, bottom: 24 });
  const c = item('C', { left: 33, top: 12, right: 48, bottom: 30 });
  assert.equal(a.bounds.right < c.bounds.left, true);
  const [group] = groupMarkerQueries([a, b, c], viewport);
  assert.deepEqual(group.members, [a, b, c]);
  assert.deepEqual(group.unionBounds, { left: 5, top: 5, right: 48, bottom: 30 });
});

test('keeps disjoint visible groups separate and returns stable input order', () => {
  const left = item('left', { left: 1, top: 1, right: 10, bottom: 10 });
  const far = item('far', { left: 50, top: 50, right: 60, bottom: 60 });
  const right = item('right', { left: 15, top: 1, right: 25, bottom: 10 });
  const groups = groupMarkerQueries([left, far, right], viewport);
  assert.deepEqual(groups.map(group => group.members), [[left], [far], [right]]);
  assert.deepEqual(groups.map(group => group.unionBounds), [left.bounds, far.bounds, right.bounds]);
});

test('omits null hidden bounds and fully offscreen markers without merging across viewport', () => {
  const visible = item('visible', { left: 90, top: 20, right: 100, bottom: 30 });
  const hidden = item('hidden', null);
  const outside = item('outside', { left: 100.01, top: 20, right: 110, bottom: 30 });
  const groups = groupMarkerQueries([hidden, visible, outside], viewport);
  assert.deepEqual(groups.map(group => group.members), [[visible]]);
  assert.deepEqual(groups[0].unionBounds, visible.bounds);
});

test('edge-touching bounds overlap inclusively and merge into an exact union', () => {
  const top = item('top', { left: 20, top: 20, right: 40, bottom: 40 });
  const edge = item('edge', { left: 40, top: 25, right: 50, bottom: 35 });
  const outside = item('outside', { left: 50.01, top: 25, right: 60, bottom: 35 });
  const groups = groupMarkerQueries([top, edge, outside], viewport);
  assert.deepEqual(groups.map(group => group.members), [[top, edge], [outside]]);
  assert.deepEqual(groups[0].unionBounds, { left: 20, top: 20, right: 50, bottom: 40 });
});
