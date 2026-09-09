import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawingRecord,
  drawingArea,
  storeDrawingRecord,
} from '../modules/tracks/archive.ts';
import { parseSavedTracks, TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import { hasTrackTime } from '../modules/tracks/provenance.ts';

const time = Date.UTC(2026, 8, 8, 10);
const segments = [
  [
    [103.33168, 30.90237],
    [103.335, 30.905],
  ],
];
const input = {
  id: 'first',
  segments,
  nodes: segments[0],
  style: { color: '#ffb477', width: 1.5 },
  name: '',
  createdAt: time,
  now: time + 60000,
  place: '汶川县 · 三江镇',
};
const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
};

test('new drawings get distinct identities, start time and coarse place metadata, not photo timestamps', () => {
  const first = drawingRecord(input);
  const second = drawingRecord({
    ...input,
    id: 'second',
    createdAt: time + 120000,
  });
  const storage = memory();
  storeDrawingRecord(first, storage);
  storeDrawingRecord(second, storage);
  assert.equal(parseSavedTracks(storage.getItem(TRACK_STORAGE)).length, 2);
  assert.notEqual(first.name, second.name);
  assert.match(first.name, /三江镇/);
  assert.equal(first.createdAt, time);
  assert.deepEqual(first.drawingLocation.coordinate, [103.33, 30.9]);
  assert.equal(hasTrackTime(first), false);
  assert.deepEqual(first.segments, segments);
});

test('continuing the selected drawing updates only that identity and keeps custom name and creation metadata', () => {
  const storage = memory();
  const first = drawingRecord({ ...input, name: '我的山路' });
  const other = drawingRecord({ ...input, id: 'other' });
  storeDrawingRecord(first, storage);
  storeDrawingRecord(other, storage);
  const extended = [...segments[0], [103.34, 30.91]];
  const next = drawingRecord({
    ...input,
    id: 'unused',
    prior: first,
    createdAt: time + 200000,
    now: time + 240000,
    segments: [extended],
    nodes: extended,
  });
  const reloaded = storeDrawingRecord(next, storage);
  assert.equal(reloaded.length, 2);
  assert.deepEqual(reloaded[1], other);
  assert.equal(next.id, first.id);
  assert.equal(next.createdAt, first.createdAt);
  assert.equal(next.name, '我的山路');
  assert.equal(next.updatedAt, time + 240000);
  assert.deepEqual(next.segments[0], extended);
  assert.deepEqual(next.drawingLocation, first.drawingLocation);
});

test('offline names use approximate coordinates and optional invalid metadata does not discard legacy geometry', () => {
  const fallback = drawingRecord({ ...input, place: undefined });
  assert.match(fallback.name, /30.90°N, 103.33°E/);
  const { drawingLocation, updatedAt, ...legacy } = fallback;
  assert.equal(drawingArea(legacy), '30.90°N, 103.33°E');
  const reloaded = parseSavedTracks(
    JSON.stringify([
      {
        ...legacy,
        updatedAt: 'bad',
        drawingLocation: { coordinate: [999, 999], label: 42 },
      },
    ]),
  );
  assert.deepEqual(reloaded, [legacy]);
});

test('empty drafts, full archive and quota errors never replace existing saved data', () => {
  assert.throws(
    () => drawingRecord({ ...input, segments: [] }),
    /没有/,
  );
  const storage = memory();
  const records = Array.from({ length: 20 }, (_, i) =>
    drawingRecord({ ...input, id: `track-${i}` }),
  );
  storage.setItem(TRACK_STORAGE, JSON.stringify(records));
  const before = storage.getItem(TRACK_STORAGE);
  assert.throws(() => storeDrawingRecord(drawingRecord(input), storage), /20/);
  assert.equal(storage.getItem(TRACK_STORAGE), before);
  const replacement = drawingRecord({ ...input, prior: records[0] });
  assert.equal(storeDrawingRecord(replacement, storage).length, 20);
  const priorValue = storage.getItem(TRACK_STORAGE);
  assert.throws(
    () =>
      storeDrawingRecord(replacement, {
        getItem: storage.getItem,
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError');
        },
      }),
    /full/,
  );
  assert.equal(storage.getItem(TRACK_STORAGE), priorValue);
});
