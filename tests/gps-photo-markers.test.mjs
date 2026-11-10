import test from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
import { exifGpsCoordinates, exifGpsAccuracy } from '../modules/photos/gps.ts';
import { newAnnotation } from '../modules/annotations/data.ts';
import { planGpsPhotoMarkers } from '../modules/photos/gpsMarkers.ts';

const blob = new Blob(['preview'], { type: 'image/jpeg' });
const draft = (n, coordinates, extra = {}) => ({
  hash: String(n).padStart(64, '0'), name: `photo-${n}.jpg`, time: null,
  preview: blob, detail: blob, zone: '', ...(coordinates ? { gpsCoordinates: coordinates } : {}), ...extra,
});
const photo = (id, markerId, coordinates, locationSource = 'exif') => ({
  id: `gps-photo:${id}`, name: `${id}.jpg`, trackId: '', trackName: '', time: 1,
  coordinates, kind: 'annotation', annotationId: markerId, locationSource,
  preview: blob, detail: blob,
});

function gpsJpegFixture() {
  const t = Buffer.alloc(152);
  t.write('II'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(1, 8);
  t.writeUInt16LE(0x8825, 10); t.writeUInt16LE(4, 12); t.writeUInt32LE(1, 14); t.writeUInt32LE(26, 18);
  t.writeUInt16LE(0, 22);
  t.writeUInt16LE(4, 26);
  const entry = (offset, tag, type, count, value) => {
    t.writeUInt16LE(tag, offset); t.writeUInt16LE(type, offset + 2);
    t.writeUInt32LE(count, offset + 4);
    if (typeof value === 'string') { t[offset + 8] = value.charCodeAt(0); t[offset + 9] = 0; }
    else t.writeUInt32LE(value, offset + 8);
  };
  entry(28, 1, 2, 2, 'S'); entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 'W'); entry(64, 4, 5, 3, 104);
  t.writeUInt32LE(0, 76);
  [[33,1],[52,1],[0,1],[151,1],[12,1],[30,1]].forEach(([n,d], i) => {
    t.writeUInt32LE(n, 80 + i * 8); t.writeUInt32LE(d, 84 + i * 8);
  });
  return Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe1,0x00,0xa0,0x45,0x78,0x69,0x66,0,0]), t, Buffer.from([0xff,0xd9])]);
}

test('EXIF GPS parses signed DMS and zero coordinates, rejects missing refs, invalid and non-WGS84 values', () => {
  const southernWestern = exifGpsCoordinates({
    GPSLatitude: [[33, 1], [52, 1], [0, 1]], GPSLatitudeRef: 'S',
    GPSLongitude: [[151, 1], [12, 1], [30, 1]], GPSLongitudeRef: 'W',
  });
  assert.ok(Math.abs(southernWestern[0] + 151.20833333333334) < 1e-10);
  assert.ok(Math.abs(southernWestern[1] + 33.86666666666667) < 1e-10);
  assert.deepEqual(exifGpsCoordinates({ GPSLatitude: [0, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [0, 0, 0], GPSLongitudeRef: 'E' }), [0, 0]);
  assert.equal(exifGpsCoordinates({ GPSLatitude: [1, 2, 3], GPSLongitude: [1, 2, 3], GPSLongitudeRef: 'E' }), undefined);
  assert.equal(exifGpsCoordinates({ GPSLatitude: [86, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [1, 0, 0], GPSLongitudeRef: 'E' }), undefined);
  assert.equal(exifGpsCoordinates({ GPSLatitude: [1, 60, 0], GPSLatitudeRef: 'N', GPSLongitude: [1, 0, 0], GPSLongitudeRef: 'E' }), undefined);
  assert.equal(exifGpsCoordinates({ GPSLatitude: [1, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [181, 0, 0], GPSLongitudeRef: 'E' }), undefined);
  assert.equal(exifGpsCoordinates({ GPSLatitude: [1, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [1, 0, 0], GPSLongitudeRef: 'E', GPSMapDatum: 'Tokyo Datum' }), undefined);
  assert.deepEqual(exifGpsCoordinates({ GPSLatitude: [1, 0, 0], GPSLatitudeRef: 'N', GPSLongitude: [1, 0, 0], GPSLongitudeRef: 'E', GPSMapDatum: 'WGS-84' }), [1, 1]);
  assert.equal(exifGpsAccuracy({ GPSHPositioningError: [[3, 2]] }), 1.5);
  assert.equal(exifGpsAccuracy({ GPSHPositioningError: -1 }), undefined);
});

test('exifr raw GPS fields flow through the same conversion used by photo imports', async () => {
  const meta = await exifr.parse(gpsJpegFixture(), {
    pick: ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSMapDatum'],
    reviveValues: false,
    translateValues: false,
  });
  const coordinates = exifGpsCoordinates(meta);
  assert.ok(Math.abs(coordinates[0] + 151.20833333333334) < 1e-10);
  assert.ok(Math.abs(coordinates[1] + 33.86666666666667) < 1e-10);
});

test('imports group by fixed nearest EXIF marker within 50m, across dateline, never chain or absorb user pins', () => {
  const manual = newAnnotation('pin', [0, 0], null, 'manual');
  const oldMarker = newAnnotation('pin', [-179.9999, 0], null, 'photo-marker:existing');
  const old = photo('e'.repeat(64), oldMarker.id, [-179.9999, 0]);
  const unrelated = photo('f'.repeat(64), manual.id, [0, 0], 'camera');
  const drafts = [
    draft(1, [179.9999, 0]), // ~22m across the dateline: joins the EXIF marker
    draft(2, [-179.9995, 0]), // ~44m from original anchor
    draft(3, [-179.9991, 0]), // within 50m of prior photo, but >50m from fixed anchor
    draft(4, [0.0001, 0]), // near a user pin only: creates a separate marker
  ];
  const result = planGpsPhotoMarkers(drafts, [manual, oldMarker], [old, unrelated]);
  assert.equal(result.added, 4);
  assert.equal(result.groups, 2);
  assert.equal(result.annotations.length, 2);
  assert.equal(result.photos[0].annotationId, oldMarker.id);
  assert.equal(result.photos[1].annotationId, oldMarker.id);
  assert.notEqual(result.photos[2].annotationId, oldMarker.id);
  assert.notEqual(result.photos[3].annotationId, manual.id);
  assert.deepEqual(result.photos[2].coordinates, drafts[2].gpsCoordinates);
  assert.equal(result.photos[0].time, 0);
  assert.equal(result.photos[0].timeUnknown, true);
});

test('reimport uses stable IDs without duplicating markers, and missing GPS is reported', () => {
  const input = [draft(11, [104, 30]), draft(12, null)];
  const first = planGpsPhotoMarkers(input, [], []);
  const second = planGpsPhotoMarkers(input, first.annotations, first.photos);
  assert.equal(first.added, 1);
  assert.equal(first.groups, 1);
  assert.equal(second.added, 0);
  assert.equal(second.groups, 0);
  assert.equal(second.duplicates, 1);
  assert.deepEqual(second.missingGps, ['photo-12.jpg']);
  assert.equal(first.photos[0].id, `gps-photo:${input[0].hash}`);
  assert.equal(first.annotations[0].id, `photo-marker:${input[0].hash.slice(0, 32)}`);
});

test('batch duplicate hashes are counted once, invalid coordinates are rejected, and generated names stay within schema limits', () => {
  const longName = `${'x'.repeat(80)}.jpg`;
  const first = draft(21, [10, 10], { name: longName });
  const same = { ...first, name: 'same-copy.jpg' };
  const second = draft(22, [20, 20], { name: longName });
  const invalid = draft(23, [NaN, 91]);
  const result = planGpsPhotoMarkers([first, same, second, invalid], [], []);
  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.missingGps, ['photo-23.jpg']);
  assert.ok(result.annotations.every((item) => item.name.length <= 60));
});
