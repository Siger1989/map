import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickLinePoint,
  markerChainage,
  trackPointAt,
} from '../modules/tracks/linePoint.ts';
import {
  newAnnotation,
  parseAnnotations,
  ANNOTATION_STORAGE,
} from '../modules/annotations/data.ts';
import { shareTrack, routeFileText } from '../modules/routeShare/data.ts';
import { routeArchiveEntries } from '../modules/routeShare/archive.ts';
import { mergeData } from '../modules/outdoor/exchange.ts';
import { TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import { normalizeTrackStyle } from '../modules/tracks/style.ts';
import { FREE_MAPS } from '../modules/mapSources/presets.ts';
import { onlineDraft } from '../modules/mapSources/online.ts';

const track = {
  id: 'trip',
  name: '测试行程',
  createdAt: 1,
  source: 'recorded',
  segments: [
    [
      [104, 30],
      [104.002, 30],
    ],
    [
      [104.005, 30],
      [104.007, 30],
    ],
  ],
  samples: [
    [
      { time: 1000, altitude: 500 },
      { time: 2000, altitude: 501 },
    ],
    [
      { time: 3000, altitude: 502 },
      { time: 4000, altitude: 503 },
    ],
  ],
};
const marker = () => ({
  ...newAnnotation('pin', [104.006, 30], 502, 'pin'),
  name: '取水点',
  trackAnchor: { trackId: track.id, distance: 289 },
});
const storage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};
test('legacy track opacity stays solid, limits prevent invisible unselectable lines and values persist', () => {
  assert.equal(normalizeTrackStyle({ color: '#ffffff', width: 2 }).opacity, 1);
  assert.equal(normalizeTrackStyle({ opacity: 0 }).opacity, 0.1);
  assert.equal(normalizeTrackStyle({ opacity: Infinity }).opacity, 1);
  assert.equal(
    normalizeTrackStyle(JSON.parse(JSON.stringify({ opacity: 0.35 }))).opacity,
    0.35,
  );
});
test('public preset catalog uses unique HTTPS keyless templates with explicit regional and historical labels', () => {
  assert.equal(new Set(FREE_MAPS.map((m) => m.id)).size, FREE_MAPS.length);
  for (const map of FREE_MAPS) {
    const parsed = onlineDraft(map);
    assert.equal(parsed.maxzoom, map.maxzoom);
    assert.ok(map.attribution && map.terms.startsWith('https://'));
    assert.doesNotMatch(map.tiles[0], /api[_-]?key|token=|tk=/i);
    if (map.category !== '全球') assert.ok(map.bounds);
  }
  assert.match(
    FREE_MAPS.find((m) => m.id === 'builtin-night-2012').detail,
    /2012.*不是实时/,
  );
});
test('line preview is on the clicked segment and never changes GPS points or samples', () => {
  const before = JSON.stringify(track);
  const project = ([lng, lat]) => ({
    x: (lng - 104) * 100000,
    y: (lat - 30) * 100000,
  });
  const point = pickLinePoint(
    track.id,
    track.segments,
    { x: 600, y: 3 },
    project,
  );
  assert.ok(point);
  assert.ok(Math.abs(point.coordinate[0] - 104.006) < 1e-6);
  assert.ok(Math.abs(point.coordinate[1] - 30) < 1e-9);
  assert.ok(point.distance > 288 && point.distance < 290);
  assert.equal(
    pickLinePoint(track.id, track.segments, { x: 350, y: 0 }, project),
    null,
    'no fabricated segment across a GPS gap',
  );
  assert.equal(
    pickLinePoint(track.id, track.segments, { x: 600, y: 25 }, project),
    null,
  );
  assert.equal(JSON.stringify(track), before);
});
test('tilted projection, dateline and route chainage stay on the real segment', () => {
  const segments = [
    [
      [179.998, 30],
      [-179.998, 30],
    ],
  ];
  const project = ([lng]) => {
    const x = (lng < 0 ? lng + 360 : lng) - 179.998;
    return { x: (x / (1 + x * 300)) * 100000, y: 0 };
  };
  const target = project([-180, 30]);
  const p = pickLinePoint('tilted', segments, target, project);
  assert.ok(p && Math.abs(Math.abs(p.coordinate[0]) - 180) < 0.00001);
  const c = markerChainage(track.segments, marker().coordinates);
  assert.ok(Math.abs(c.fraction - 0.75) < 0.00001);
  assert.ok(
    Math.abs(trackPointAt(track.segments, c.distance)[0] - 104.006) < 0.00001,
  );
  const loop = [
    [
      [104, 30],
      [104.002, 30],
      [104, 30],
    ],
  ];
  assert.ok(
    markerChainage(loop, [104, 30], 1000).fraction > 0.99,
    'preferred chainage disambiguates repeated coordinates',
  );
});
test('track markers survive storage and route archive with GPX waypoints and original GPS', () => {
  const pin = marker(),
    other = {
      ...marker(),
      id: 'other',
      trackAnchor: { trackId: 'another', distance: 1 },
    };
  assert.deepEqual(parseAnnotations(JSON.stringify([pin]))[0], pin);
  assert.throws(() =>
    parseAnnotations(
      JSON.stringify([
        { ...pin, trackAnchor: { trackId: 'trip', distance: -1 } },
      ]),
    ),
  );
  const data = shareTrack(track, [pin, other]);
  const gpx = routeFileText(data, 'gpx'),
    kml = routeFileText(data, 'kml');
  assert.match(gpx, /<wpt lat="30" lon="104.006">/);
  assert.match(gpx, /<ele>501<\/ele>/);
  assert.match(kml, /<name>取水点<\/name>/);
  const files = routeArchiveEntries(data, [], new Blob(['preview']));
  assert.deepEqual(
    JSON.parse(files.find((f) => f.path === '山兔路线.json').data).annotations,
    [pin],
  );
  assert.ok(files.some((f) => f.path === '行程标记.xlsx'));
});
test('import remaps marker association when track IDs conflict and does not attach orphan pins', () => {
  const store = storage();
  store.setItem(
    TRACK_STORAGE,
    JSON.stringify([{ ...track, name: '本机另一条行程' }]),
  );
  store.setItem(ANNOTATION_STORAGE, JSON.stringify([marker()]));
  const transfer = {
    format: 'guanyun-backup',
    version: 1,
    tracks: [track],
    annotations: [marker()],
    favorites: [],
  };
  mergeData(transfer, store);
  const importedTrack = JSON.parse(store.getItem(TRACK_STORAGE)).find(
    (t) => t.name === track.name,
  );
  const pins = JSON.parse(store.getItem(ANNOTATION_STORAGE));
  assert.notEqual(importedTrack.id, track.id);
  assert.equal(pins.length, 2);
  assert.equal(pins[1].trackAnchor.trackId, importedTrack.id);
  assert.equal(pins[0].trackAnchor.trackId, track.id);
  const orphanStore = storage();
  mergeData({ ...transfer, tracks: [] }, orphanStore);
  assert.equal(
    JSON.parse(orphanStore.getItem(ANNOTATION_STORAGE))[0].trackAnchor,
    undefined,
  );
});
