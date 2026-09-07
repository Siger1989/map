import test from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
import { exifAltitude, validDetails } from '../modules/photos/details.ts';
import { matchPhoto } from '../modules/photos/matching.ts';
import { validPhoto } from '../modules/photos/storage.ts';
import {
  photoWeatherRequest,
  parsePhotoWeather,
} from '../modules/photos/weather.ts';
const time = Date.UTC(2026, 8, 1),
  coordinates = [104, 30];
test('real EXIF GPS byte reference decodes below-sea-level altitude', async () => {
  // A minimal JPEG APP1 with TIFF GPS IFD, without any private photo data.
  const t = Buffer.alloc(64);
  t.write('II');
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(8, 4);
  t.writeUInt16LE(1, 8);
  t.writeUInt16LE(34853, 10);
  t.writeUInt16LE(4, 12);
  t.writeUInt32LE(1, 14);
  t.writeUInt32LE(26, 18);
  t.writeUInt16LE(2, 26);
  t.writeUInt16LE(5, 28);
  t.writeUInt16LE(1, 30);
  t.writeUInt32LE(1, 32);
  t[36] = 1;
  t.writeUInt16LE(6, 40);
  t.writeUInt16LE(5, 42);
  t.writeUInt32LE(1, 44);
  t.writeUInt32LE(56, 48);
  t.writeUInt32LE(123, 56);
  t.writeUInt32LE(1, 60);
  const jpeg = Buffer.concat([
    Buffer.from([255, 216, 255, 225, 0, 72, 69, 120, 105, 102, 0, 0]),
    t,
    Buffer.from([255, 217]),
  ]);
  const meta = await exifr.parse(jpeg, {
    pick: ['GPSAltitude', 'GPSAltitudeRef'],
    reviveValues: false,
    translateValues: false,
  });
  assert.deepEqual(exifAltitude(meta), { metres: -123, source: 'exif' });
});
test('altitude preserves negative/zero EXIF and never fabricates missing altitude', () => {
  assert.deepEqual(exifAltitude({ GPSAltitude: 10, GPSAltitudeRef: 1 }), {
    metres: -10,
    source: 'exif',
  });
  assert.equal(exifAltitude({ GPSAltitude: 0, GPSAltitudeRef: 0 }).metres, 0);
  assert.equal(exifAltitude({ GPSAltitude: 10 }), undefined);
  assert.equal(
    exifAltitude({ GPSAltitude: NaN, GPSAltitudeRef: 0 }),
    undefined,
  );
  const track = {
    segments: [[coordinates, [104.001, 30]]],
    samples: [
      [
        { time, altitude: 0 },
        { time: time + 60000, altitude: 100 },
      ],
    ],
  };
  assert.deepEqual(matchPhoto(track, time).altitude, {
    metres: 0,
    source: 'track',
  });
  assert.deepEqual(matchPhoto(track, time + 30000).altitude, {
    metres: 50,
    source: 'interpolated',
  });
  track.samples[0][1].altitude = null;
  assert.equal(matchPhoto(track, time + 30000).altitude, undefined);
});
test('photo details remain optional for old databases; malformed ink cannot enter storage', () => {
  assert.equal(
    validPhoto({
      id: 'old',
      name: 'old',
      trackId: 't',
      trackName: 't',
      time,
      coordinates,
      kind: 'point',
      preview: new Blob(['preview'], { type: 'image/jpeg' }),
    }),
    true,
  );
  assert.equal(
    validDetails({
      strokes: [
        {
          color: '#ff625c',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
      note: '山顶',
      rotation: 90,
    }),
    true,
  );
  for (const p of [
    { strokes: [{ color: '#ff625c', points: [[2, 0]] }] },
    { rotation: 91 },
    { title: 'a'.repeat(101) },
    { altitude: { metres: null, source: 'exif' } },
    { weather: { time } },
  ])
    assert.equal(!!validDetails(p), false);
});
test('photo weather queries the capture date across UTC midnight and uses explicit model provenance', () => {
  const recent = photoWeatherRequest(time - 60000, coordinates, time);
  assert.equal(recent.source, 'forecast');
  assert.equal(
    new URL(recent.url).searchParams.get('start_date'),
    '2026-09-01',
  );
  assert.equal(recent.hour, time);
  const old = photoWeatherRequest(time, coordinates, time + 10 * 86400000);
  assert.equal(old.source, 'era5');
  assert.equal(new URL(old.url).searchParams.get('models'), 'era5');
  assert.throws(() => photoWeatherRequest(time + 86400000, coordinates, time));
});
test('weather requires the requested hour; null rain/temperature never become zero or current weather', () => {
  const payload = {
    hourly: {
      time: [time / 1000],
      temperature_2m: [null],
      precipitation: [0],
      wind_speed_10m: [3],
      weather_code: [null],
    },
  };
  const w = parsePhotoWeather(payload, time, 'era5', time + 1);
  assert.equal(w.temperature, null);
  assert.equal(w.precipitation, 0);
  assert.equal(w.time, time);
  assert.equal(w.source, 'era5');
  assert.throws(() => parsePhotoWeather(payload, time + 3600000, 'era5'));
  assert.throws(() =>
    parsePhotoWeather({ hourly: { time: [time / 1000] } }, time, 'era5'),
  );
});
