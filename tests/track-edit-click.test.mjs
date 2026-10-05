import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTrackEditClick } from '../modules/map/trackEditClick.ts';

function fixture({ node = null, line = null, route = false } = {}) {
  const calls = [];
  handleTrackEditClick({
    pickNode: () => { calls.push('pick-node'); return node; },
    pickLine: () => { calls.push('pick-line'); return line; },
    pickRoute: () => { calls.push('pick-route'); return route; },
    onNodeSelect: value => calls.push(['node', value]),
    onLineSelect: value => calls.push(['line', value]),
    onRouteSelect: () => calls.push('route'),
    onMapPick: () => calls.push('map'),
  });
  return calls;
}

test('track edit click selects the planned route after editable track hits miss', () => {
  assert.deepEqual(fixture({ route: true }), [
    'pick-node', 'pick-line', 'pick-route', 'route',
  ]);
});

test('editable nodes and line points retain priority over planned route picking', () => {
  assert.deepEqual(fixture({ node: { id: 'n' }, line: { id: 'l' }, route: true }), [
    'pick-node', ['node', { id: 'n' }],
  ]);
  assert.deepEqual(fixture({ line: { id: 'l' }, route: true }), [
    'pick-node', 'pick-line', ['line', { id: 'l' }],
  ]);
});

test('an empty track edit click still falls through to map pick', () => {
  assert.deepEqual(fixture(), [
    'pick-node', 'pick-line', 'pick-route', 'map',
  ]);
});
