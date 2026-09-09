import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionPreviewPoints } from '../modules/collections/previewBounds.ts';
import { newAnnotation } from '../modules/annotations/data.ts';
import { mapPhotos } from '../modules/photos/association.ts';
test('collection preview includes full model extent at high latitude and retains route geometry', () => {
  const a = {
    ...newAnnotation('box', [104, 70], 500, 'model'),
    width: 600,
    length: 800,
    height: 300,
    heading: 45,
    pitch: 30,
  };
  const e = {
    key: 'annotation:model',
    name: 'model',
    detail: '',
    coordinates: a.coordinates,
    kind: 'model',
    annotation: a,
  };
  const bounds = collectionPreviewPoints(e);
  assert.ok(bounds[0][0] < 104 && bounds[1][0] > 104);
  assert.ok((bounds[1][1] - 70) * 111195 > Math.hypot(600, 800, 300));
  assert.ok(bounds[1][0] - 104 > bounds[1][1] - 70);
  const line = [
    [179.8, 30],
    [-179.8, 30.1],
  ];
  assert.deepEqual(
    collectionPreviewPoints({
      kind: 'track',
      track: { segments: [line] },
      coordinates: line[0],
    }),
    line,
  );
  assert.equal(a.width, 600);
});
test('photo map badge follows live marker icon and colour without rewriting original capture metadata', () => {
  const a = {
    ...newAnnotation('pin', [104, 30], 500, 'pin'),
    icon: 'camp',
    color: '#123456',
  };
  const p = {
    id: 'p',
    kind: 'annotation',
    annotationId: 'pin',
    coordinates: [105, 31],
  };
  const shown = mapPhotos([p], [a])[0];
  assert.equal(shown.mapIcon, 'camp');
  assert.equal(shown.mapColor, '#123456');
  assert.deepEqual(shown.coordinates, a.coordinates);
  assert.deepEqual(p.coordinates, [105, 31]);
  assert.equal(p.mapIcon, undefined);
});
