import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  makeRouteQr,
  readRouteQr,
  ROUTE_QR_PREFIX,
  QR_BUDGET,
} from '../modules/routeShare/qrCodec.ts';
import { qrTransfer } from '../modules/routeShare/qrImport.ts';
import { validFavorite } from '../modules/navigation/favorites.ts';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { externalLegs, shareImageTerminals, shareTrack } from '../modules/routeShare/data.ts';
const data = {
  name: '成都东站 → 春熙路',
  mode: 'bicycle',
  distance: 1000,
  duration: 300,
  estimated: false,
  segments: [
    [
      [104, 30],
      [104.001, 30.002],
      [104.006, 30.004],
    ],
  ],
  stops: [
    { name: '成都东站', coordinates: [104, 30] },
    { name: '春熙路', coordinates: [104.006, 30.004] },
  ],
};
test('offline QR round trips mode, names, endpoints and is readable by the app QR decoder', () => {
  const qr = makeRouteQr(data),
    value = readRouteQr(qr.text);
  assert.ok(qr.text.length <= QR_BUDGET);
  assert.deepEqual(value.segments, data.segments);
  assert.deepEqual(value.stops, data.stops);
  assert.equal(value.mode, 'bicycle');
  const model = QRCode.create(qr.text, { errorCorrectionLevel: 'M' }),
    scale = 4,
    padding = 4,
    size = (model.modules.size + padding * 2) * scale,
    pixels = new Uint8ClampedArray(size * size * 4);
  pixels.fill(255);
  for (let y = 0; y < model.modules.size; y++)
    for (let x = 0; x < model.modules.size; x++)
      if (model.modules.get(y, x))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i =
              (((y + padding) * scale + dy) * size +
                (x + padding) * scale +
                dx) *
              4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
  assert.equal(jsQR(pixels, size, size)?.data, qr.text);
  const imported = qrTransfer(value, 1000);
  assert.equal(imported.transfer.favorites.length, 0);
  const [track] = parseSavedTracks(JSON.stringify(imported.transfer.tracks));
  assert.deepEqual(track.sharedRoute.stops, data.stops);
  assert.equal(track.navigationMode, 'bicycle');
  assert.ok(validFavorite(trackNavigation(track)));
  assert.deepEqual(trackNavigation(track).route.stops, data.stops);
});
test('complex routes aggressively simplify QR only while retaining protected stops and original image/file geometry', () => {
  const points = Array.from({ length: 2500 }, (_, i) => [
      104 + i * 0.00004,
      30 + Math.sin(i * 1.8) * 0.004,
    ]),
    stops = [
      { name: '起', coordinates: points[0] },
      { name: '中', coordinates: points[1200] },
      { name: '终', coordinates: points.at(-1) },
    ],
    original = { ...data, segments: [points], stops };
  const before = JSON.stringify(original),
    qr = makeRouteQr(original),
    value = readRouteQr(qr.text);
  assert.ok(value.tolerance > 50);
  assert.ok(qr.text.length <= QR_BUDGET);
  assert.equal(JSON.stringify(original), before);
  assert.ok(
    value.segments[0].some((p) => Math.abs(p[0] - points[1200][0]) < 0.000001),
  );
  assert.deepEqual(value.stops, stops);
  const imported = qrTransfer(value, 1000);
  assert.equal(imported.transfer.favorites.length, 0);
  assert.equal(imported.track.sharedRoute.tolerance, value.tolerance);
  assert.ok(validFavorite(trackNavigation(imported.track)));
});
test('corrupt, oversized and decompression length abuse are rejected before import', () => {
  assert.throws(() => readRouteQr('https://tiles.example.org'), /不是/);
  assert.throws(() => readRouteQr(ROUTE_QR_PREFIX + 'zzzz:AAAA'), /损坏/);
  assert.throws(
    () => readRouteQr(ROUTE_QR_PREFIX + '1:' + 'A'.repeat(3000)),
    /不是/,
  );
});

test('unconfirmed branch shares full geometry without inventing a terminal in image, QR or navigation', () => {
  const a = [104.0000004, 30.0000004], b = [104.0010004, 30],
    c = [104.0020004, 30], d = [104.0010004, 30.001];
  const track = { id: 'fork', name: '有分叉的路线', createdAt: 1, segments: [[a, b, c], [b, d]] };
  const shared = shareTrack(track);
  assert.deepEqual(shared.segments, track.segments);
  assert.deepEqual(shared.stops.map(s => s.coordinates), [a]);
  assert.deepEqual(shareImageTerminals(shared).map(t => t.label), ['起点']);
  assert.deepEqual(externalLegs(shared), []);
  const scanned = readRouteQr(makeRouteQr(shared).text);
  assert.equal(scanned.stops.length, 1);
  const imported = qrTransfer(scanned, 1000).track;
  assert.equal(imported.sharedRoute, undefined);
  assert.deepEqual(imported.routeTerminals?.start, imported.segments[0][0]);
  assert.deepEqual(parseSavedTracks(JSON.stringify([imported]))[0].routeTerminals, imported.routeTerminals);

  const chosen = shareTrack({ ...track, routeTerminals: { start: a, end: c } });
  assert.deepEqual(chosen.stops.map(s => s.coordinates), [a, c]);
  assert.deepEqual(shareImageTerminals(chosen).map(t => t.point), [a, c]);
  assert.equal(externalLegs(chosen).length, 1);
  const legacyJoined = shareTrack({ ...track, segments: [[a, b], [b, c]] });
  assert.deepEqual(legacyJoined.stops.map(s => s.coordinates), [a, c]);
  const previouslyPlanned = shareTrack({
    ...track, sharedRoute: { stops: [{name:'出发',coordinates:a},{name:'到达',coordinates:d}], duration:null, tolerance:0 },
  });
  assert.deepEqual(previouslyPlanned.stops.map(s => s.coordinates), [a, d]);
});
