import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readNativePosition,
  watchNativePosition,
} from '../modules/position/nativePosition.ts';
import {
  canFollow,
  cameraMoved,
  positionZoom,
} from '../modules/position/follow.ts';

const now = Date.now();
const sample = {
  mode: 'network',
  error: '',
  fix: {
    longitude: 104,
    latitude: 30,
    accuracy: 900,
    timestamp: now,
    source: 'network',
  },
};
test('network fixes retain coarse accuracy and expire without masquerading as GPS', () => {
  const fix = readNativePosition(JSON.stringify(sample), now).fix;
  assert.deepEqual(fix, {
    coordinates: [104, 30],
    accuracy: 900,
    timestamp: now,
    source: 'network',
  });
  assert.equal(canFollow(fix, now), true);
  assert.equal(canFollow({ ...fix, source: 'gps' }, now), false);
  assert.ok(positionZoom(fix) < positionZoom({ ...fix, accuracy: 10 }));
  for (const patch of [
    { timestamp: now - 30001 },
    { timestamp: now + 5001 },
    { accuracy: -1 },
    { longitude: 300 },
    { source: 'cell-guessed' },
  ]) {
    const result = readNativePosition(
      JSON.stringify({ ...sample, fix: { ...sample.fix, ...patch } }),
      now,
    );
    assert.equal(result.fix, null);
    assert.ok(result.error);
  }
});
test('native polling deduplicates fixes, handles mode races, expires old data and stops once', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now });
  let raw = JSON.stringify({ ...sample, mode: 'auto' }),
    fixes = 0,
    stops = 0;
  const errors = [];
  const stop = watchNativePosition(
    {
      locate(mode) {
        assert.equal(mode, 'network');
      },
      locationState() {
        return raw;
      },
      stopLocation() {
        stops++;
      },
    },
    'network',
    () => fixes++,
    (e) => errors.push(e),
  );
  t.mock.timers.tick(1000);
  assert.equal(fixes, 0);
  raw = JSON.stringify(sample);
  t.mock.timers.tick(10000);
  assert.equal(fixes, 1);
  t.mock.timers.tick(25000);
  assert.equal(fixes, 1);
  assert.match(errors.at(-1), /过期/);
  stop();
  t.mock.timers.tick(10000);
  assert.equal(stops, 1);
  assert.equal(fixes, 1);
});
test('stationary jitter does not animate terrain, but real movement and improved accuracy do', () => {
  const fix = {
    coordinates: [104, 30],
    accuracy: 12,
    timestamp: now,
    source: 'gps',
  };
  assert.equal(cameraMoved(null, fix), true);
  assert.equal(
    cameraMoved(fix, {
      ...fix,
      coordinates: [104.000001, 30],
      timestamp: now + 1000,
    }),
    false,
  );
  assert.equal(cameraMoved(fix, { ...fix, coordinates: [104.001, 30] }), true);
  assert.equal(
    cameraMoved(
      { ...fix, source: 'network', accuracy: 900 },
      { ...fix, source: 'network', accuracy: 200 },
    ),
    true,
  );
});
