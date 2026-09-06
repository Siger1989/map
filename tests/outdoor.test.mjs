import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFix,
  emptyRecording,
  readRecording,
  resumeRecording,
} from '../modules/outdoor/recording.ts';
import {
  collectData,
  mergeData,
  validateTransfer,
  exportGPX,
} from '../modules/outdoor/exchange.ts';
import { planBounds, regionTiles } from '../modules/outdoor/offline.ts';
const fix = (time, x = 103, accuracy = 10) => ({
  coordinates: [x, 31],
  time,
  accuracy,
  altitude: null,
});
test('recording filters bad fixes, preserves pauses and long signal gaps', () => {
  let r = resumeRecording({ ...emptyRecording(), id: 'one', startedAt: 1000 });
  r = appendFix(r, fix(1000), 1000);
  assert.equal(r.segments[0].length, 1);
  assert.equal(appendFix(r, fix(2000, 104), 2000), r);
  assert.equal(appendFix(r, fix(2000, 103, 100), 2000), r);
  assert.equal(appendFix(r, fix(2000), 40000), r);
  r = appendFix(r, fix(10000, 103.001), 10000);
  assert.equal(r.segments[0].length, 2);
  r = resumeRecording({ ...r, phase: 'paused' });
  r = appendFix(r, fix(20000, 104), 20000);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[1].length, 1);
  r = appendFix(r, fix(150001, 104.001), 150001);
  assert.equal(r.segments.length, 3);
  assert.throws(() => readRecording('{"phase":"recording"}'));
});
const blank = () => ({
  format: 'guanyun-backup',
  version: 1,
  tracks: [],
  annotations: [],
  favorites: [],
});
const track = {
  id: 'a',
  name: 'A & <B>',
  createdAt: 100,
  segments: [
    [
      [103, 31],
      [103.1, 31],
    ],
    [
      [104, 31],
      [104.1, 31],
    ],
  ],
};
const memory = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
test('import validates all records, deduplicates and preserves conflicting originals', () => {
  const storage = memory(),
    data = { ...blank(), tracks: [track] };
  mergeData(data, storage);
  mergeData(data, storage);
  assert.equal(collectData(storage).tracks.length, 1);
  mergeData({ ...data, tracks: [{ ...track, name: 'changed' }] }, storage);
  const restored = collectData(storage);
  assert.equal(restored.tracks.length, 2);
  assert.equal(restored.tracks[0].name, track.name);
  assert.notEqual(restored.tracks[1].id, track.id);
  assert.throws(() =>
    validateTransfer({
      ...data,
      tracks: [
        {
          ...track,
          segments: [
            [
              [999, 31],
              [103, 31],
            ],
          ],
        },
      ],
    }),
  );
  const xml = exportGPX(data);
  assert.ok(xml.includes('A &amp; &lt;B&gt;'));
  assert.equal((xml.match(/<trkseg>/g) ?? []).length, 2);
});
test('quota failure rolls back completed writes', () => {
  const storage = memory();
  mergeData({ ...blank(), tracks: [track] }, storage);
  const before = JSON.stringify(collectData(storage));
  let count = 0;
  const failing = {
    ...storage,
    setItem: (k, v) => {
      if (++count === 2) throw Error('quota');
      storage.setItem(k, v);
    },
  };
  assert.throws(() =>
    mergeData({ ...blank(), tracks: [{ ...track, id: 'b' }] }, failing),
  );
  assert.equal(JSON.stringify(collectData(storage)), before);
});
test('offline planning covers extent at every zoom and rejects excessive requests', () => {
  const bounds = planBounds([[103.28, 31.08]]),
    urls = regionTiles(bounds, 14, 'https://example.test/{z}/{x}/{y}');
  assert.ok(bounds[0] < 103.28 && bounds[2] > 103.28);
  assert.ok(urls.includes('https://example.test/0/0/0'));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.length < 700);
  assert.throws(() =>
    planBounds([
      [100, 30],
      [110, 30],
    ]),
  );
  assert.throws(() => regionTiles([100, 30, 102, 32], 14, '{z}/{x}/{y}'));
});

test('GPS timestamps and elevation survive backup and GPX export', () => {
  const tracked = {
    ...track,
    samples: [
      [
        { time: 0, altitude: 10 },
        { time: 1000, altitude: null },
      ],
      [
        { time: 2000, altitude: 20 },
        { time: null, altitude: 30 },
      ],
    ],
  };
  const data = validateTransfer({ ...blank(), tracks: [tracked] });
  const xml = exportGPX(data);
  assert.ok(xml.includes('<time>1970-01-01T00:00:00.000Z</time>'));
  assert.ok(xml.includes('<ele>10</ele>'));
  assert.equal((xml.match(/<time>/g) ?? []).length, 3);
  assert.throws(() =>
    validateTransfer({ ...blank(), tracks: [{ ...tracked, samples: [[]] }] }),
  );
});
