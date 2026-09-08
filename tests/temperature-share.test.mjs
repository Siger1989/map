import test from 'node:test';
import assert from 'node:assert/strict';
import { temperatureFeatures } from '../modules/weather/temperature.ts';
import { applyLayerPatch, DEFAULT_LAYERS } from '../modules/map/types.ts';
import {
  routeBounds,
  externalLegs,
  shareTrack,
  routeFileText,
} from '../modules/routeShare/data.ts';
test('temperature maps use selected hour, keep missing transparent and separate thematic colors', () => {
  const data = {
    cells: [
      { lng: 103, lat: 30, hours: [{ temperature: 0 }, { temperature: 28 }] },
      {
        lng: 104,
        lat: 30,
        hours: [{ temperature: null }, { temperature: -5 }],
      },
    ],
  };
  assert.equal(temperatureFeatures(data, 0).features.length, 1);
  assert.deepEqual(
    temperatureFeatures(data, 1).features.map((f) => f.properties.temperature),
    [28, -5],
  );
  assert.equal(temperatureFeatures(data, 9).features.length, 0);
  const settings = applyLayerPatch(
    { ...DEFAULT_LAYERS, geology: true },
    { temperature: true },
  );
  assert.equal(settings.geology, false);
  assert.equal(settings.temperature, true);
  assert.equal(
    applyLayerPatch(settings, { elevationColors: true }).temperature,
    false,
  );
});
test('share bounds preserve whole geometry across antimeridian and file preserves original segments/times', () => {
  const track = {
    id: 'a',
    name: 'A & B',
    createdAt: 0,
    segments: [
      [
        [179, 30],
        [-179, 31],
      ],
      [
        [-178, 29],
        [-177, 32],
      ],
    ],
    samples: [
      [
        { time: 1000, altitude: 400 },
        { time: 2000, altitude: 500 },
      ],
      [
        { time: null, altitude: null },
        { time: null, altitude: null },
      ],
    ],
  };
  const b = routeBounds(track.segments);
  assert.deepEqual(b, [
    [179, 29],
    [183, 32],
  ]);
  const shared = shareTrack(track),
    before = JSON.stringify(track),
    gpx = routeFileText(shared, 'gpx');
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 2);
  assert.match(gpx, /<ele>400<\/ele>/);
  assert.match(gpx, /1970-01-01T00:00:01.000Z/);
  assert.match(gpx, /A &amp; B/);
  assert.equal(JSON.stringify(track), before);
});
test('external links retain exact stop sequence, WGS84 coordinates, and selected mode in every leg', () => {
  const stops = [
    { name: 'start', coordinates: [103, 30] },
    { name: 'via', coordinates: [103.1, 30.1] },
    { name: 'end', coordinates: [103.2, 30.2] },
  ];
  const links = externalLegs({ stops, mode: 'bicycle' });
  assert.equal(links.length, 2);
  for (const l of links) {
    const p = new URL(l.url).searchParams;
    assert.equal(p.get('mode'), 'ride');
    assert.equal(p.get('coordinate'), 'wgs84');
  }
  assert.match(
    new URL(links[1].url).searchParams.get('from'),
    /^103.1,30.1,via$/,
  );
});
