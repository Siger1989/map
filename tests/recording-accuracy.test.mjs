import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendFix,
  emptyRecording,
  resumeRecording,
  readRecording,
} from '../modules/outdoor/recording.ts';
import {
  readRecordingAccuracy,
  validRecordingAccuracy,
  recordingAccuracyMessage,
} from '../modules/outdoor/recordingPreferences.ts';
import { recordingPosition } from '../modules/position/follow.ts';

const initial = () =>
  resumeRecording({
    ...emptyRecording(),
    id: 'precision-test',
    startedAt: 100000,
  });
const fix = (time, accuracy, x = 104.066) => ({
  time,
  coordinates: [x, 30.659],
  accuracy,
  altitude: null,
});
test('recording default rejects coarse fixes; custom threshold accepts its exact boundary', () => {
  const record = initial();
  assert.equal(appendFix(record, fix(100000, 21), 100000), record);
  assert.equal(
    appendFix(record, fix(100000, 20), 100000).segments[0].length,
    1,
  );
  assert.equal(appendFix(record, fix(100000, 11), 100000, 10), record);
  assert.equal(
    appendFix(record, fix(100000, 10), 100000, 10).segments[0].length,
    1,
  );
  assert.equal(
    appendFix(record, fix(100000, 60), 100000, 80).segments[0].length,
    1,
  );
  assert.equal(recordingPosition(record), null);
});
test('changing threshold affects only future points and never invalidates legacy samples', () => {
  const prior = appendFix(initial(), fix(100000, 70), 100000, 80);
  assert.deepEqual(readRecording(JSON.stringify(prior)), prior);
  assert.equal(appendFix(prior, fix(110000, 30, 104.0662), 110000, 10), prior);
  const next = appendFix(prior, fix(120000, 9, 104.0663), 120000, 10);
  assert.equal(next.segments[0].length, 2);
  assert.equal(next.segments[0][0].accuracy, 70);
  assert.equal(recordingPosition(next).accuracy, 9);
  assert.equal(appendFix(next, fix(130000, 8, 105), 130000, 10), next);
  assert.equal(appendFix(next, fix(130000, 8), 170000, 10), next);
});
test('precision preferences validate strict integers without accepting invalid stored values', () => {
  for (const value of [5, 10, 20, 50, 80])
    assert.ok(validRecordingAccuracy(value));
  for (const value of [null, '', '10', 0, 4, 81, 10.5, Infinity, NaN]) {
    assert.equal(validRecordingAccuracy(value), false);
    assert.equal(readRecordingAccuracy(value), 20);
  }
  assert.match(recordingAccuracyMessage(30.1, 10), /31 米.*10 米.*未记录/);
  assert.equal(recordingAccuracyMessage(10, 10), '');
});
