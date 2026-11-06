import assert from 'node:assert/strict';
import test from 'node:test';
import { closestNativeTrackNodePick } from '../modules/map/native/trackNodePick.ts';

const point = (id, longitude) => ({ kind: 'trackNode', trackId: 'same-line', coordinate: [longitude, 0], id });
const project = ([longitude]) => ({ x: longitude * 100, y: 20 });

test('fallback touch chooses the closest of two same-line node handles, independent of pick order', () => {
  const farther = point('fixed-a', 0.3), nearer = point('fixed-b', 0.4);
  const selected = closestNativeTrackNodePick([farther, nearer], [], 'same-line', { x: 39, y: 20 }, project);
  assert.equal(selected, nearer);
});

test('an exact node pixel hit takes priority over other handles in the expanded touch box', () => {
  const exact = point('exact', 0.2), closerFallback = point('fallback', 0.4);
  const selected = closestNativeTrackNodePick([closerFallback, exact], [exact], 'same-line', { x: 39, y: 20 }, project);
  assert.equal(selected, exact);
});

test('an exact marker does not mask a nearby movable node, and another track cannot steal the drag', () => {
  const target = point('active-track-node', 0.4);
  const otherTrack = { ...point('other-track-node', 0.39), trackId: 'other-line' };
  const exactMarker = { kind: 'annotation', trackId: 'pin-1' };
  const selected = closestNativeTrackNodePick([otherTrack, target], [exactMarker], 'same-line', { x: 39, y: 20 }, project);
  assert.equal(selected, target);
});

test('node pick ignores other tracks, malformed coordinates, and unprojectable candidates', () => {
  const selected = closestNativeTrackNodePick([
    { ...point('other-track', 0.39), trackId: 'other' },
    { ...point('invalid', 0), coordinate: [NaN, 0] },
    point('offscreen', 0.4),
  ], [], 'same-line', { x: 39, y: 20 }, (coordinate) => coordinate[0] === 0.4 ? null : project(coordinate));
  assert.equal(selected, null);
});
