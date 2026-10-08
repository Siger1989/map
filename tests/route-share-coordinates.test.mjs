import test from 'node:test';
import assert from 'node:assert/strict';
import { shareDraftTrack } from '../modules/tracks/shareDraft.ts';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style.ts';
import { shareTrack, routeTransfer, routeFileText } from '../modules/routeShare/data.ts';
import { exportCoordinateExchangeCsv, exportCoordinateExchangeJson } from '../modules/coordinates/exchange.ts';
import { WEB_MERCATOR_CRS } from '../modules/coordinates/index.ts';
import { withTerrainProfileSamples } from '../modules/tracks/terrainProfileSamples.ts';
import { metresBetween } from '../modules/navigation/types.ts';

test('live hand-drawn route can be shared without saving or inventing GPS time', () => {
  const segments = [[[103, 31], [103.01, 31]]];
  const draft = shareDraftTrack({
    segments,
    name: '当前草稿',
    style: DEFAULT_TRACK_STYLE,
    edgeColors: [['#ff0000']],
  });
  assert.ok(draft);
  assert.equal(draft.id, 'draft');
  assert.equal(draft.createdAt, 0);
  assert.equal(draft.source, 'manual');
  assert.equal(draft.name, '当前草稿');
  assert.deepEqual(draft.segments, segments);
  assert.deepEqual(draft.edgeColors, [['#ff0000']]);
  assert.equal(draft.samples, undefined);
  assert.equal(shareDraftTrack({ segments: [[[103, 31]]], style: DEFAULT_TRACK_STYLE }), null);

  const shared = shareTrack(draft);
  assert.equal(shared.duration, null);
  assert.equal(shared.estimated, true);
  assert.doesNotMatch(routeFileText(shared, 'gpx'), /<time>|<ele>/);
  assert.match(routeFileText(shared, 'kml'), /<coordinates>103,31 103\.01,31<\/coordinates>/);
});

test('route engineering JSON/CSV retain samples altitude in selected CRS; GPX stays WGS84', () => {
  const track = {
    ...shareDraftTrack({ segments: [[[103, 31], [103.01, 31]]], style: DEFAULT_TRACK_STYLE }),
    samples: [[{ time: null, altitude: 1142 }, { time: null, altitude: 2386 }]],
  };
  const shared = shareTrack(track);
  const transfer = routeTransfer(shared);
  const json = JSON.parse(exportCoordinateExchangeJson(transfer, WEB_MERCATOR_CRS));
  assert.equal(json.crs.id, 'EPSG:3857');
  assert.ok(json.features[0].geometry.coordinates[0][0] > 1_000_000);
  assert.equal(json.features[0].geometry.coordinates[0][2], 1142);
  assert.equal(json.features[0].geometry.coordinates[1][2], 2386);
  const csv = exportCoordinateExchangeCsv(transfer, WEB_MERCATOR_CRS);
  assert.match(csv, /# CRS_JSON=/);
  assert.match(csv, /,1142,/);
  assert.match(csv, /,2386,/);
  const gpx = routeFileText(shared, 'gpx');
  assert.match(gpx, /lat="31" lon="103"/);
  assert.match(gpx, /<ele>1142<\/ele>/);
  assert.doesNotMatch(gpx, /<time>/);
});

test('the displayed DEM profile becomes aligned export samples without adding time or changing route geometry', () => {
  const segments = [[[103, 31], [103.001, 31], [103.002, 31]]];
  const track = { id:'draft', name:'DEM draft', createdAt:0, source:'manual', style:DEFAULT_TRACK_STYLE, segments };
  const middle = metresBetween(segments[0][0], segments[0][1]);
  const total = middle + metresBetween(segments[0][1], segments[0][2]);
  const samples = [
    { coordinates:segments[0][0], distance:0, part:0, elevation:1142 },
    { coordinates:segments[0][1], distance:middle, part:0, elevation:null },
    { coordinates:segments[0][2], distance:total, part:0, elevation:2386 },
  ];
  const withProfile = withTerrainProfileSamples(track, [segments[0]], samples);
  assert.deepEqual(withProfile.segments, segments);
  assert.deepEqual(withProfile.samples, [[
    { time:null, altitude:1142 },
    { time:null, altitude:null },
    { time:null, altitude:2386 },
  ]]);
  const shared = shareTrack(withProfile);
  const gpx = routeFileText(shared, 'gpx');
  const kml = routeFileText(shared, 'kml');
  assert.match(gpx, /<ele>1142<\/ele>/);
  assert.match(gpx, /<ele>2386<\/ele>/);
  assert.doesNotMatch(gpx, /<time>/);
  assert.match(kml, /<altitudeMode>absolute<\/altitudeMode>/);
  assert.match(kml, /<coordinates>103,31,1142/);
  assert.match(kml, /<coordinates>103\.002,31,2386/);
  assert.match(kml, /<altitudeMode>clampToGround<\/altitudeMode>/);
});
