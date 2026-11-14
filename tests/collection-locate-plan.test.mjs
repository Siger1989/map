import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionLocatePlan } from '../modules/collections/previewBounds.ts';

test('pin and model catalog entries focus their anchor instead of fitting a 30m footprint', () => {
  const coordinates = [112.1695, 37.2038];
  assert.deepEqual(collectionLocatePlan({ kind: 'pin', coordinates }), { kind: 'point', coordinate: coordinates });
  assert.deepEqual(collectionLocatePlan({ kind: 'model', coordinates }), { kind: 'point', coordinate: coordinates });
});

test('route catalog entries keep fitting their actual route extent', () => {
  const coordinates = [[112, 37], [112.01, 37.01]];
  assert.deepEqual(collectionLocatePlan({ kind: 'route', route: { route: { coordinates } } }), {
    kind: 'fit', coordinates,
  });
});
