import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { ANNOTATION_STORAGE, parseAnnotations } from '../modules/annotations/data.ts';
import { COLLECTION_STORAGE, defaultLayout, parseLayout } from '../modules/collections/data.ts';
import { fileGpsPhotoMarkers, saveGpsPhotoMarkers } from '../modules/photos/saveGpsMarkers.ts';
import { readPhotos, validPhoto } from '../modules/photos/storage.ts';
import { photoLocationLabel, photoTimeLabel } from '../modules/photos/association.ts';

const image = new Blob(['test'], { type: 'image/jpeg' });
const draft = (n, extra = {}) => ({ hash: String(n).padStart(64, '0'), name: `test-${n}.jpg`,
  time: null, preview: image, detail: image, zone: '', gpsCoordinates: [104, 30], ...extra });
function store() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) };
}

test('GPS save creates a real photo folder and marker, links photos and skips reimport', async () => {
  const storage = store();
  storage.setItem('unrelated-setting', 'preserved');
  const result = await saveGpsPhotoMarkers([draft(111)], storage);
  assert.equal(result.added, 1);
  const annotations = parseAnnotations(storage.getItem(ANNOTATION_STORAGE));
  assert.equal(annotations.length, 1);
  const layout = parseLayout(storage.getItem(COLLECTION_STORAGE));
  assert.equal(layout.groups.find(g => g.id === layout.assignments[`annotation:${annotations[0].id}`]).name, '照片');
  const saved = (await readPhotos()).find(p => p.id === `gps-photo:${draft(111).hash}`);
  assert.ok(validPhoto(saved));
  assert.equal(saved.annotationId, annotations[0].id);
  assert.equal(saved.timeUnknown, true);
  assert.equal(photoTimeLabel(saved), '拍摄时间未记录');
  assert.equal(photoLocationLabel(saved), '照片 GPS · WGS84');
  const raw = storage.getItem(ANNOTATION_STORAGE);
  const again = await saveGpsPhotoMarkers([draft(111)], storage);
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 1);
  assert.deepEqual(again.coordinates, [annotations[0].coordinates]);
  const missingGps = await saveGpsPhotoMarkers([draft(111, { gpsCoordinates: undefined })], storage);
  assert.equal(missingGps.added, 0);
  assert.equal(missingGps.missingGps.length, 1);
  assert.deepEqual(missingGps.coordinates, [], 'a GPS-less input cannot trigger a camera move using an old matching photo');
  assert.equal(storage.getItem(ANNOTATION_STORAGE), raw);
  assert.equal(storage.getItem('unrelated-setting'), 'preserved');
});

test('a failed photo transaction restores exact annotation and collection snapshots', async () => {
  const storage = store();
  const before = (await readPhotos()).map(p => p.id);
  await assert.rejects(saveGpsPhotoMarkers([draft(222, { preview: new Blob(['bad'], { type: 'text/plain' }) })], storage), /照片预览数据无效/);
  assert.equal(storage.getItem(ANNOTATION_STORAGE), null);
  assert.equal(storage.getItem(COLLECTION_STORAGE), null);
  assert.deepEqual((await readPhotos()).map(p => p.id), before);
});

test('collection write failure rolls back the newly written marker before saving any photo', async () => {
  const storage = store();
  const originalSet = storage.setItem;
  storage.setItem = (key, value) => { if (key === COLLECTION_STORAGE) throw new Error('quota'); originalSet(key, value); };
  await assert.rejects(saveGpsPhotoMarkers([draft(333)], storage), /quota/);
  assert.equal(storage.getItem(ANNOTATION_STORAGE), null);
  assert.ok(!(await readPhotos()).some(p => p.id.endsWith(draft(333).hash)));
});

test('photo folder reuses an existing user folder and preserves unrelated assignments', () => {
  const layout = defaultLayout();
  layout.groups.push({ id: 'custom-photos', name: '照片', color: '#123456' });
  layout.assignments['annotation:old'] = 'manual';
  const next = fileGpsPhotoMarkers(layout, ['new']);
  assert.equal(next.groups.length, layout.groups.length);
  assert.equal(next.assignments['annotation:new'], 'custom-photos');
  assert.equal(next.assignments['annotation:old'], 'manual');
  assert.equal(next.groups.find(g => g.id === 'custom-photos').color, '#123456');
});
