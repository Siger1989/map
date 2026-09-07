import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRecordingSnapshot } from '../modules/outdoor/nativeRecordingSnapshot.ts';
import { emptyRecording } from '../modules/outdoor/recording.ts';

test('unchanged native polls preserve record and geometry identity in every phase', () => {
  const read = nativeRecordingSnapshot();
  for (const phase of ['idle', 'recording', 'paused', 'finished']) {
    const raw = JSON.stringify({ ...emptyRecording(), phase });
    const first = read(raw);
    for (let i = 0; i < 40; i++) {
      assert.equal(read(raw), first);
      assert.equal(read(raw).segments, first.segments);
    }
  }
});

test('new fixes, recording commands and quality errors still update immediately', () => {
  const read = nativeRecordingSnapshot();
  const record = { ...emptyRecording(), id: 'trip', phase: 'recording' };
  let previous = read(JSON.stringify(record));
  for (const patch of [
    {
      segments: [
        [
          {
            coordinates: [103, 30],
            time: 1800000000000,
            accuracy: 5,
            altitude: 1000,
          },
        ],
      ],
    },
    { error: '等待更精确定位' },
    { phase: 'paused' },
    { phase: 'finished' },
    emptyRecording(),
  ]) {
    Object.assign(record, patch);
    const next = read(JSON.stringify(record));
    assert.notEqual(next, previous);
    assert.deepEqual(next, record);
    previous = next;
  }
});

test('failed native payloads do not poison cache and a recovered poll clears transient error', () => {
  const read = nativeRecordingSnapshot();
  const raw = JSON.stringify(emptyRecording());
  const good = read(raw);
  assert.throws(() => read('{broken'));
  assert.throws(() => read('{broken'));
  const displayedError = { ...good, error: '原生记录暂时无法读取' };
  const recovered = read(raw);
  assert.equal(recovered, good);
  assert.notEqual(recovered, displayedError);
  assert.equal(recovered.error, '');
});
