import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBoxSelection, selectInBox, twoFingerGestureDelta } from '../modules/collections/boxSelection.ts';

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

test('two-finger map gesture tracks centroid pan and pinch zoom from its first move', () => {
  const delta = twoFingerGestureDelta(
    [{ x: 10, y: 10 }, { x: 30, y: 10 }],
    [{ x: 20, y: 25 }, { x: 60, y: 25 }],
  );
  assert.deepEqual(delta.pan, { x: 20, y: 15 });
  assert.equal(delta.zoom, 1);
  assert.deepEqual(delta.around, { x: 40, y: 25 });
  const panOnly = twoFingerGestureDelta(
    [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    [{ x: 5, y: 7 }, { x: 25, y: 7 }],
  );
  assert.deepEqual(panOnly.pan, { x: 5, y: 7 });
  assert.equal(panOnly.zoom, 0);
});
