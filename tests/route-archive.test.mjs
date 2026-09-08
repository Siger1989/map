import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { archiveBlob, archiveName } from '../modules/files/archive.ts';
import { routeArchiveEntries } from '../modules/routeShare/archive.ts';
import { shareTrack } from '../modules/routeShare/data.ts';
import { photosForTrack } from '../modules/photos/trackPhotos.ts';
import { sendArchive } from '../modules/files/nativeArchive.ts';
import {
  ELEVATION_FINE_COLORS,
  ELEVATION_COLORS,
  elevationColor,
} from '../modules/terrain/elevationColors.ts';

const track = {
  id: 'record-1',
  source: 'recorded',
  name: '实走/成都',
  createdAt: 1000,
  segments: [
    [
      [104, 30],
      [104.001, 30.001],
    ],
    [
      [104.002, 30.002],
      [104.003, 30.003],
    ],
  ],
  samples: [
    [
      { time: 1000, altitude: 501 },
      { time: 2000, altitude: 503 },
    ],
    [
      { time: 4000, altitude: 505 },
      { time: 5000, altitude: 504 },
    ],
  ],
};
const preview = new Blob([Uint8Array.of(255, 216, 255, 1)], {
  type: 'image/jpeg',
});
const detail = new Blob([Uint8Array.of(255, 216, 255, 2, 3)], {
  type: 'image/jpeg',
});
const photo = (id, time, trackId = track.id) => ({
  id,
  name: '同名/照片.jpg',
  trackId,
  trackName: track.name,
  time,
  coordinates: [104, 30],
  kind: 'point',
  preview,
  detail,
  note: '编号00123\n完整备注',
  url: 'blob:ephemeral',
});
test('route ZIP contains QR image, unchanged GPS samples and only associated photos in time order', async () => {
  const photos = [
    photo('late', 5000),
    photo('other', 2000, 'unrelated'),
    { ...photo('early', 1000), detail: undefined },
  ];
  assert.deepEqual(
    photosForTrack(track, photos).map((p) => p.id),
    ['early', 'late'],
  );
  const entries = routeArchiveEntries(shareTrack(track), photos, preview);
  const bytes = new Uint8Array(
    await (await archiveBlob(entries)).arrayBuffer(),
  );
  const files = unzipSync(bytes);
  assert.deepEqual(
    files['路线图-含二维码.jpg'],
    new Uint8Array(await preview.arrayBuffer()),
  );
  const backup = JSON.parse(strFromU8(files['山兔路线.json']));
  assert.deepEqual(backup.tracks[0], track);
  const gpx = strFromU8(files['完整路线.gpx']);
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
  assert.match(gpx, /1970-01-01T00:00:01.000Z/);
  assert.match(gpx, /<ele>503<\/ele>/);
  const manifest = JSON.parse(strFromU8(files['照片清单.json']));
  assert.equal(manifest.photos.length, 2);
  assert.match(manifest.photos[0].quality, /预览/);
  assert.match(manifest.photos[1].quality, /2560/);
  assert.equal(manifest.photos[0].note, '编号00123\n完整备注');
  assert.ok(!('url' in manifest.photos[0]));
  assert.deepEqual(
    files[manifest.photos[0].file],
    new Uint8Array(await preview.arrayBuffer()),
  );
  assert.deepEqual(
    files[manifest.photos[1].file],
    new Uint8Array(await detail.arrayBuffer()),
  );
  assert.ok(unzipSync(files['照片清单.xlsx'])['xl/worksheets/sheet1.xml']);
});
test('ZIP rejects duplicate/traversal filenames and cancellation leaves no partial result', async () => {
  assert.equal(archiveName('../../a:b.jpg'), '_.._a_b.jpg');
  for (const path of ['../escape', '/absolute', 'a/../b', 'a\\b'])
    await assert.rejects(archiveBlob([{ path, data: 'x' }]), /文件名/);
  await assert.rejects(
    archiveBlob([
      { path: 'same', data: 'a' },
      { path: 'same', data: 'b' },
    ]),
    /冲突/,
  );
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(
    archiveBlob([{ path: 'data.txt', data: 'x' }], cancel.signal),
    { name: 'AbortError' },
  );
});
test('Android ZIP delivery crosses the old 8 MB boundary with ordered bounded chunks and abort cleanup', async () => {
  const data = new Uint8Array(9 * 1024 * 1024 + 17);
  data[0] = 80;
  data[1] = 75;
  data[data.length - 1] = 42;
  let offset = 0,
    finished = false,
    cancelled = false;
  const bridge = {
    archiveBegin: (name, size) => {
      assert.match(name, /\.zip$/);
      assert.equal(size, data.length);
      return 'ok:test';
    },
    archiveAppend: (token, start, encoded) => {
      assert.equal(token, 'test');
      assert.equal(start, offset);
      assert.ok(encoded.length <= 256 * 1024);
      const bytes = Buffer.from(encoded, 'base64');
      assert.deepEqual(
        bytes,
        Buffer.from(data.subarray(start, start + bytes.length)),
      );
      offset += bytes.length;
      return 'ok';
    },
    archiveFinish: () => {
      assert.equal(offset, data.length);
      finished = true;
      return 'ok';
    },
    archiveCancel: () => {
      cancelled = true;
    },
  };
  await sendArchive(new File([data], 'Shantu-route-123.zip'), false, bridge);
  assert.ok(finished && cancelled);
  const abort = new AbortController();
  finished = false;
  cancelled = false;
  await assert.rejects(
    sendArchive(
      new File([data], 'Shantu-route-123.zip'),
      true,
      {
        ...bridge,
        archiveAppend: () => {
          abort.abort();
          return 'ok';
        },
      },
      abort.signal,
    ),
    { name: 'AbortError' },
  );
  assert.ok(cancelled && !finished);
});
test('50 metre shades distinguish every adjacent contour and retain major palette anchors', () => {
  for (const [height, color] of ELEVATION_COLORS)
    assert.equal(elevationColor(height), color);
  for (let i = 1; i < ELEVATION_FINE_COLORS.length; i++)
    assert.notEqual(
      ELEVATION_FINE_COLORS[i][1],
      ELEVATION_FINE_COLORS[i - 1][1],
    );
  assert.equal(elevationColor(524), elevationColor(500));
  assert.notEqual(elevationColor(550), elevationColor(500));
});
