import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBoxSelection, selectInBox } from '../modules/collections/boxSelection.ts';

test('repeated additive boxes union disjoint and overlapping hits; subtraction never selects outsiders', () => {
  const key = p => p.join(',');
  const a = [10, 20], b = [30, 40], c = [50, 60];
  const original = [a, b, c];
  let selected = updateBoxSelection([], [a], 'add', key);
  selected = updateBoxSelection(selected, [b, [...a]], 'add', key);
  assert.deepEqual(selected, [a, b]);
  selected = updateBoxSelection(selected, [a, c], 'subtract', key);
  assert.deepEqual(selected, [b]);
  // Returning to add after exiting/re-entering keeps the existing selection.
  selected = updateBoxSelection(selected, [a, c], 'add', key);
  assert.deepEqual(selected, [b, a, c]);
  assert.deepEqual(original, [[10, 20], [30, 40], [50, 60]]);
  assert.deepEqual(updateBoxSelection(selected, selected, 'subtract', key), []);
});

test('object box subtraction uses the same geometry and leaves saved data unchanged', () => {
  const entries = ['a', 'b', 'c'].map((key, i) => ({ key, kind: 'annotation', coordinates: [i * 10, 10], annotation: { visible: true } }));
  const before = JSON.stringify(entries), project = ([x, y]) => ({ x, y });
  const hit = selectInBox(entries, { left: 9, right: 11, top: 0, bottom: 20 }, project);
  assert.deepEqual(hit, ['b']);
  assert.deepEqual(updateBoxSelection(['a', 'b', 'c'], hit, 'subtract', k => k), ['a', 'c']);
  assert.deepEqual(updateBoxSelection(['a'], hit, 'add', k => k), ['a', 'b']);
  assert.equal(JSON.stringify(entries), before);
});
