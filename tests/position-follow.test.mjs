import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingPosition, canFollow } from '../modules/position/follow.ts';
import {
  emptyRecording,
  appendFix,
  resumeRecording,
} from '../modules/outdoor/recording.ts';

test('recording follow uses latest accepted point including one-point and resumed segments', () => {
  const now = 1800000000000;
  let record = resumeRecording(emptyRecording());
  assert.equal(recordingPosition(record), null);
  record = appendFix(
    record,
    { coordinates: [104, 30], time: now, accuracy: 5, altitude: 500 },
    now,
  );
  assert.deepEqual(recordingPosition(record), {
    coordinates: [104, 30],
    timestamp: now,
    accuracy: 5,
  });
  record = resumeRecording({ ...record, phase: 'paused' });
  assert.equal(recordingPosition(record).timestamp, now);
  assert.equal(canFollow(recordingPosition(record), now + 60000), false);
  record = appendFix(
    record,
    {
      coordinates: [104.001, 30],
      time: now + 60000,
      accuracy: 5,
      altitude: 500,
    },
    now + 60000,
  );
  assert.deepEqual(recordingPosition(record).coordinates, [104.001, 30]);
});

test('camera rejects missing, stale, future, invalid and low-accuracy fixes', () => {
  const now = 1800000000000,
    fix = { coordinates: [104, 30], timestamp: now, accuracy: 5 };
  assert.equal(canFollow(fix, now), true);
  for (const rejected of [
    null,
    { ...fix, timestamp: now - 20001 },
    { ...fix, timestamp: now + 5001 },
    { ...fix, timestamp: NaN },
    { ...fix, accuracy: 81 },
    { ...fix, accuracy: -1 },
    { ...fix, coordinates: [Infinity, 30] },
  ])
    assert.equal(canFollow(rejected, now), false);
});
