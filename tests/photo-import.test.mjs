import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import exifr from 'exifr';
import { imageMime, nativeImportOriginalHash, selectPhotoFiles } from '../modules/photos/selection.ts';

test('recognizes common photo formats and keeps a known extension when MIME is stale', () => {
  assert.equal(imageMime({ name: 'camera.HEIC', type: 'application/octet-stream' }), 'image/heic');
  assert.equal(imageMime({ name: 'trip.avif', type: 'application/x-unknown' }), 'image/avif');
  assert.equal(imageMime({ name: 'walk.jpeg', type: 'image/jpg' }), 'image/jpeg');
  assert.equal(imageMime({ name: 'frame.gif', type: 'image/gif' }), 'image/gif');
  assert.equal(imageMime({ name: 'scan.bmp', type: '' }), 'image/bmp');
});

test('does not infer an unsupported format from a generic image MIME alone', () => {
  assert.equal(imageMime({ name: 'raw.dng', type: 'image/dng' }), null);
  assert.equal(imageMime({ name: 'unknown', type: 'application/octet-stream' }), null);
});

test('folder selection includes formats with stale provider MIME values', () => {
  const selected = selectPhotoFiles([
    { name: 'a.avif', type: 'application/octet-stream' },
    { name: 'b.heic', type: 'application/x-camera-image' },
    { name: 'c.dng', type: 'image/dng' },
  ], true);
  assert.deepEqual(selected.map((file) => file.name), ['a.avif', 'b.heic']);
});

test('only a marked generated JPEG can supply the preserved source hash', () => {
  const hash = 'a'.repeat(64);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]).buffer;
  assert.equal(nativeImportOriginalHash({ ImageUniqueID: hash }, 'image/jpeg', jpeg), null);
  assert.equal(nativeImportOriginalHash({ ImageUniqueID: hash, UserComment: `SHANTU_NATIVE_PHOTO_V1:${hash}` }, 'image/png', jpeg), null);
  assert.equal(nativeImportOriginalHash({ ImageUniqueID: hash, UserComment: `SHANTU_NATIVE_PHOTO_V1:${hash}` }, 'image/jpeg', jpeg), hash);
  assert.equal(nativeImportOriginalHash({ ImageUniqueID: hash, UserComment: `ASCII\0\0\0SHANTU_NATIVE_PHOTO_V1:${hash}` }, 'image/jpeg', jpeg), hash);
});

test('the actual EXIF parser returns lowercase binary userComment for a generated JPEG', async () => {
  const file = await readFile(new URL('./fixtures/photos/native-generated.jpg', import.meta.url));
  const meta = await exifr.parse(file, { pick: ['ImageUniqueID', 'UserComment'], reviveValues: false, translateValues: false });
  assert.ok(ArrayBuffer.isView(meta.userComment), 'this fixture exercises the real binary parser result');
  const bytes = Uint8Array.from(file).buffer;
  assert.equal(nativeImportOriginalHash(meta, 'image/jpeg', bytes), 'a'.repeat(64));
  const invalid = { ...meta, userComment: new TextEncoder().encode('ASCII\0\0\0SHANTU_NATIVE_PHOTO_V1:' + 'b'.repeat(64)) };
  assert.equal(nativeImportOriginalHash(invalid, 'image/jpeg', bytes), null, 'mismatched metadata does not override the content digest');
});
