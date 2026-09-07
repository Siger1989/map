import test from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
const { parse } = exifr;
import { readFile } from 'node:fs/promises';
import { photoTime, matchPhoto } from '../modules/photos/matching.ts';
const time = Date.UTC(2026, 8, 7, 2, 0, 0);
const track = {
  id: 't',
  name: 'test',
  createdAt: time,
  segments: [
    [
      [104, 30],
      [104.001, 30],
    ],
  ],
  samples: [[{ time }, { time: time + 60000 }]],
};
test('real JPEG EXIF reads original capture time and timezone independently of local timezone', async () => {
  const meta = await parse(
    await readFile(new URL('./fixtures/photos/timed.jpg', import.meta.url)),
    { pick: ['DateTimeOriginal', 'OffsetTimeOriginal'], reviveValues: false },
  );
  assert.equal(meta.DateTimeOriginal, '2026:09:07 10:00:30');
  assert.equal(
    photoTime(meta.DateTimeOriginal, meta.OffsetTimeOriginal),
    time + 30000,
  );
  assert.equal(photoTime('2026:02:30 10:00:00', '+08:00'), null);
  assert.equal(photoTime('2026:09:07 24:00:00', '+08:00'), null);
  assert.equal(photoTime('2026:09:07 10:00:00', '+14:30'), null);
  assert.equal(photoTime(undefined), null);
  assert.equal(
    photoTime('2026:09:07 10:00:00'),
    new Date(2026, 8, 7, 10).getTime(),
  );
});
test('photo matches exact points or within a short timestamped segment, never extrapolates', () => {
  assert.equal(matchPhoto(track, time).kind, 'point');
  const middle = matchPhoto(track, time + 30000);
  assert.equal(middle.kind, 'interpolated');
  assert.ok(Math.abs(middle.coordinates[0] - 104.0005) < 1e-8);
  assert.equal(matchPhoto(track, time - 1), null);
  assert.equal(matchPhoto(track, time + 60001), null);
  assert.equal(matchPhoto(track, null), null);
  assert.equal(matchPhoto({ ...track, samples: undefined }, time), null);
  assert.equal(
    matchPhoto({ ...track, samples: [[{ time }, { time: null }]] }, time + 1),
    null,
  );
  assert.equal(
    matchPhoto(
      { ...track, samples: [[{ time }, { time: time + 180000 }]] },
      time + 30000,
    ),
    null,
  );
  assert.equal(
    matchPhoto(
      { ...track, samples: [[{ time: time + 60000 }, { time }]] },
      time + 30000,
    ),
    null,
  );
});
test('photo matching respects pauses, rejects ambiguous overlaps and handles dateline', () => {
  const paused = {
    ...track,
    segments: [[[104, 30]], [[104.001, 30]]],
    samples: [[{ time }], [{ time: time + 60000 }]],
  };
  assert.equal(matchPhoto(paused, time + 30000), null);
  const ambiguous = {
    ...track,
    segments: [
      ...track.segments,
      [
        [105, 30],
        [105.001, 30],
      ],
    ],
    samples: [...track.samples, ...track.samples],
  };
  assert.equal(matchPhoto(ambiguous, time + 30000), null);
  const edge = {
    ...track,
    segments: [
      [
        [179.999, 30],
        [-179.999, 30],
      ],
    ],
  };
  assert.ok(
    Math.abs(Math.abs(matchPhoto(edge, time + 30000).coordinates[0]) - 180) <
      1e-7,
  );
});
