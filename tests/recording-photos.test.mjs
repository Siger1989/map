import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveRecording,
  recordingTrack,
} from '../modules/outdoor/savedRecording.ts';
import { parseSavedTracks, TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import {
  hasTrackTime,
  photoTrackChoice,
  keepsOriginalPoints,
  trackSourceLabel,
} from '../modules/tracks/provenance.ts';
import { matchPhoto } from '../modules/photos/matching.ts';
import { selectPhotoFiles, imageMime } from '../modules/photos/selection.ts';
import { moveTrackNode } from '../modules/tracks/editing.ts';

const time = Date.UTC(2026, 8, 7, 2);
const fix = (time, x) => ({
  coordinates: [x, 30.659],
  time,
  altitude: 500,
  accuracy: 5,
});
const record = {
  id: 'recorded-test',
  phase: 'finished',
  startedAt: time,
  error: '',
  segments: [
    [fix(time, 104.066), fix(time + 60000, 104.0661)],
    [],
    [fix(time + 180000, 104.0662)],
    [fix(time + 240000, 104.0663), fix(time + 300000, 104.0664)],
  ],
};
const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};

test('finished recording saves real time and pause alignment; reloaded track still matches photos', () => {
  const storage = memory();
  const saved = saveRecording(record, storage);
  assert.equal(saved.source, 'recorded');
  const reloaded = parseSavedTracks(storage.getItem(TRACK_STORAGE))[0];
  assert.deepEqual(reloaded, saved);
  assert.deepEqual(
    reloaded.samples.map((s) => s.map((p) => p.time)),
    [
      [time, time + 60000],
      [time + 240000, time + 300000],
    ],
  );
  const photo = matchPhoto(reloaded, time + 30000);
  assert.ok(Math.abs(photo.coordinates[0] - 104.06605) < 1e-8);
  assert.equal(matchPhoto(reloaded, time + 200000), null);
  saveRecording(record, storage);
  assert.equal(parseSavedTracks(storage.getItem(TRACK_STORAGE)).length, 1);
  assert.equal(record.segments.length, 4);
});

test('recording appearance survives saving and reload without changing GPS samples', () => {
  const storage = memory();
  const styled = { ...record, style: { color: '#55d6ff', width: 3 } };
  const saved = saveRecording(styled, storage);
  assert.deepEqual(saved.style, styled.style);
  const restored = parseSavedTracks(storage.getItem(TRACK_STORAGE))[0];
  assert.deepEqual(restored.style, styled.style);
  assert.deepEqual(restored.segments, recordingTrack(record).segments);
  assert.deepEqual(restored.samples, recordingTrack(record).samples);
  assert.equal(recordingTrack(record).style, undefined);
});

test('failed persistence cannot report a successful save or alter the original checkpoint', () => {
  const before = JSON.stringify(record);
  assert.throws(
    () =>
      saveRecording(record, {
        getItem: () => null,
        setItem: () => {
          throw Error('quota');
        },
        removeItem() {},
      }),
    /存储不足/,
  );
  assert.throws(
    () =>
      saveRecording(record, {
        getItem: () => null,
        setItem() {},
        removeItem() {},
      }),
    /保存未确认/,
  );
  assert.throws(
    () => saveRecording({ ...record, phase: 'recording' }, memory()),
    /先结束/,
  );
  assert.equal(JSON.stringify(record), before);
});

test('legacy timed tracks and stale manual selection resolve to a valid photo target', () => {
  const legacy = recordingTrack(record);
  delete legacy.source;
  const manual = {
    id: 'manual',
    name: '手绘',
    createdAt: time,
    segments: legacy.segments,
  };
  assert.ok(hasTrackTime(legacy));
  assert.equal(photoTrackChoice([manual, legacy], 'manual', 'draft'), legacy);
  assert.equal(photoTrackChoice([manual, legacy], 'deleted'), legacy);
  assert.equal(
    photoTrackChoice([manual, legacy], 'deleted', null, true),
    undefined,
  );
  assert.equal(photoTrackChoice([manual], 'manual'), undefined);
  assert.equal(trackSourceLabel(recordingTrack(record)), '实走轨迹');
  assert.equal(trackSourceLabel(legacy), '带时间轨迹');
  assert.equal(trackSourceLabel(manual), '手绘轨迹');
  assert.ok(keepsOriginalPoints(legacy));
  assert.equal(moveTrackNode(legacy, legacy.segments[0][0], [105, 31]), legacy);
});

test('folder selection filters documents, accepts generic MIME photos and enforces explicit limits', () => {
  const jpg = { name: 'trip.JPG', type: '' },
    png = { name: 'a.png', type: 'application/octet-stream' };
  assert.equal(imageMime(jpg), 'image/jpeg');
  assert.deepEqual(
    selectPhotoFiles(
      [jpg, png, { name: 'notes.txt', type: 'text/plain' }],
      true,
    ),
    [jpg, png],
  );
  assert.throws(() => selectPhotoFiles(Array(201).fill(jpg), true), /200/);
  assert.equal(selectPhotoFiles(Array(200).fill(jpg), true).length, 200);
  assert.throws(() => selectPhotoFiles(Array(31).fill(jpg), false), /30/);
  assert.throws(
    () =>
      selectPhotoFiles([{ name: 'script.jpg', type: 'text/javascript' }], true),
    /没有支持/,
  );
});
