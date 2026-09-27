import test from 'node:test';
import assert from 'node:assert/strict';
import { featurePreviewUiPublisher } from '../modules/map/featurePreviewUi.ts';

const node = { trackId: 'route-a', coordinate: [104, 30] };
const move = (coordinate, snappedNode) => ({ target: { kind: 'track', node }, coordinate, ...(snappedNode ? { snappedNode } : {}) });

test('120 drag frames publish only start and finish to React while snap changes remain visible', () => {
  const calls = [];
  const publish = featurePreviewUiPublisher(value => calls.push(value));
  for (let i = 0; i < 120; i++) publish(move([104 + i / 10000, 30]));
  assert.equal(calls.length, 1);
  const snap = { trackId: 'route-b', coordinate: [105, 31] };
  publish(move(snap.coordinate, snap));
  publish(move(snap.coordinate, { ...snap }));
  assert.equal(calls.length, 2);
  publish(move([104.5, 30]));
  assert.equal(calls.length, 3);
  publish(null);
  assert.equal(calls.at(-1), null);
  publish(move([104.1, 30]));
  assert.equal(calls.length, 5);
});

test('annotation and area coordinates still publish each preview', () => {
  const calls = [];
  const publish = featurePreviewUiPublisher(value => calls.push(value));
  for (const kind of ['annotation', 'area']) {
    for (let i = 0; i < 3; i++) publish({ target: { kind, id: kind, coordinate: [104, 30], index: 0 }, coordinate: [104 + i, 30] });
  }
  assert.equal(calls.length, 6);
});
