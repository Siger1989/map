import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingMapProjection } from '../modules/mapComparison/drawingMapProjection.ts';

test('pane projection identity survives UI renders and follows map replacement', () => {
  const first = { toScreen: ([x, y]) => ({ x, y }) };
  const ref = { current: first }, other = { current: first };
  const project = drawingMapProjection(ref);
  assert.equal(drawingMapProjection(ref), project);
  assert.notEqual(drawingMapProjection(other), project, 'each pane has its own cache identity');
  assert.deepEqual(project([3, 4]), { x: 3, y: 4 });
  ref.current = { toScreen: ([x, y]) => ({ x: x + 10, y }) };
  const replaced = drawingMapProjection(ref);
  assert.notEqual(replaced, project);
  assert.deepEqual(replaced([3, 4]), { x: 13, y: 4 });
  ref.current = null;
  assert.equal(drawingMapProjection(ref)([3, 4]), null);
});
