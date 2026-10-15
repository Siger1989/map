import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelemetryFix, navigationAverageSpeed, navigationFixSpeed } from '../modules/guidance/useNavigationTelemetry.ts';

const at = 1_000_000;
const fix = (longitude, timestamp, extra = {}) => ({
  coordinates: [longitude, 30], accuracy: 5, timestamp, ...extra,
});

test('fresh device GPS speed is preferred and real zero is preserved', () => {
  assert.equal(navigationFixSpeed(null, fix(103, at, { speed: 3 }), 'bicycle', at), 10.8);
  assert.equal(navigationFixSpeed(null, fix(103, at, { speed: 0 }), 'bicycle', at), 0);
});

test('credible displacement is the fallback when a fix has no speed field', () => {
  const previous = fix(103, at - 5000);
  const current = fix(103.0001, at);
  const speed = navigationFixSpeed(previous, current, 'bicycle', at);
  assert.ok(speed > 6 && speed < 8, `expected plausible motion speed, got ${speed}`);
});

test('stale, network and implausible fixes do not create telemetry', () => {
  const current = fix(103, at, { speed: 2 });
  assert.equal(isTelemetryFix(fix(103, at - 25_000), at), false);
  assert.equal(navigationFixSpeed(null, { ...current, source: 'network' }, 'auto', at), null);
  assert.equal(navigationFixSpeed(null, { ...current, provider: 'ip' }, 'auto', at), null);
  assert.equal(navigationFixSpeed(null, fix(103, at, { speed: 200 }), 'bicycle', at), null);
});

test('average uses travelled distance and elapsed session time through gaps and off-route states', () => {
  const session = {
    last: fix(103, at - 500_000),
    travelled: 1000,
    gap: true,
    offRoute: true,
    quality: '定位暂不可用',
  };
  assert.equal(navigationAverageSpeed(session, 500), 7.2);
  assert.equal(navigationAverageSpeed({ ...session, gap: false, offRoute: false }, 500), 7.2);
  assert.equal(navigationAverageSpeed({ ...session, last: null }, 500), 7.2, 'a stale or cleared last fix does not erase valid session distance');
  assert.equal(navigationAverageSpeed({ ...session, travelled: 0 }, 500), null);
});
