import test from 'node:test';
import assert from 'node:assert/strict';
import { collectData } from '../modules/dataTransfer/storage.ts';
import { TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import { ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
import { FAVORITES_STORAGE } from '../modules/navigation/favorites.ts';
import { COLLECTION_STORAGE, defaultLayout } from '../modules/collections/data.ts';

function memoryStorage(initial) {
  const values = new Map(initial);
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
  };
}

function track(name) {
  return {
    id: 'cache-test-track', name, createdAt: 1, source: 'manual',
    segments: [[[103, 30], [103.1, 30.1]]],
  };
}

test('collectData caches only an unchanged storage snapshot and returns isolated mutable results', () => {
  const storage = memoryStorage([
    [TRACK_STORAGE, JSON.stringify([track('first')])],
    [ANNOTATION_STORAGE, '[]'],
    [FAVORITES_STORAGE, '[]'],
    [COLLECTION_STORAGE, JSON.stringify(defaultLayout())],
  ]);

  const first = collectData(storage);
  first.tracks[0].name = 'caller mutation';
  first.tracks[0].segments[0][0][0] = -1;
  const sameSnapshot = collectData(storage);
  assert.equal(sameSnapshot.tracks[0].name, 'first');
  assert.deepEqual(sameSnapshot.tracks[0].segments[0][0], [103, 30]);
  assert.notEqual(sameSnapshot, first);
  assert.notEqual(sameSnapshot.tracks, first.tracks);

  storage.values.set(TRACK_STORAGE, JSON.stringify([track('changed')]));
  assert.equal(collectData(storage).tracks[0].name, 'changed');
  storage.values.set(TRACK_STORAGE, '{invalid');
  assert.throws(() => collectData(storage), SyntaxError);
  assert.throws(() => collectData(storage), SyntaxError, 'invalid data is never cached');

  storage.values.set(TRACK_STORAGE, JSON.stringify([track('changed')]));
  const recovered = collectData(storage);
  assert.equal(recovered.tracks[0].name, 'changed');

  storage.values.set(COLLECTION_STORAGE, '{invalid');
  assert.throws(() => collectData(storage), SyntaxError);
  storage.values.set(COLLECTION_STORAGE, JSON.stringify(defaultLayout()));
  assert.equal(collectData(storage).tracks[0].name, 'changed');
});

test('collectData does not reuse a snapshot across different storage objects', () => {
  const initial = [
    [TRACK_STORAGE, JSON.stringify([track('same')])],
    [ANNOTATION_STORAGE, '[]'],
    [FAVORITES_STORAGE, '[]'],
  ];
  const firstStorage = memoryStorage(initial);
  const secondStorage = memoryStorage(initial);
  const first = collectData(firstStorage);
  const second = collectData(secondStorage);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});
