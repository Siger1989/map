import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalDayBounds, getSkyPosition } from '../modules/sky/astronomy.ts';
import { findMoonPreview, getMoonGuide } from '../modules/sky/moonGuideGeometry.ts';

const optics = { horizontalFov: 45, verticalFov: 70 };
const pose = { azimuth: 90, altitude: 20, roll: 0 };
const level = altitudeDeg => ({
  directions: Array.from({ length: 360 }, () => ({ altitudeDeg, coverage: 1 })),
  coverage: 1,
  status: 'complete',
});
const scene = { pose, optics, terrain: level(0), width: 360, height: 780 };
const direction = (azimuthDeg, altitudeDeg) => ({ azimuthDeg, altitudeDeg });
const guide = (moon, overrides) => getMoonGuide({ ...scene, moon, ...overrides });

test('only verified unobstructed targets in the active calibrated viewport receive a marker', () => {
  const { x, y } = guide(direction(90, 20)).point;
  assert.ok(Math.abs(x - 180) < 1e-8);
  assert.ok(Math.abs(y - 390) < 1e-8);
  assert.equal(guide(direction(90, 20), { terrain: level(25) }).state, 'blocked');
  assert.equal(guide(direction(90, -1)).state, 'below');
  assert.equal(guide(direction(90, -1), { terrain: level(-3) }).state, 'visible');
  assert.equal(guide(direction(90, 20), { terrain: null }).state, 'unknown');
  assert.equal(guide(direction(90, 20), { terrain: null }).point, null);
  assert.equal(guide(direction(90, 20), { optics: null }).state, 'unaligned');
});

test('outside targets give right, left, above and rear guidance', () => {
  assert.match(guide(direction(135, 20)).message, /向右转/);
  assert.match(guide(direction(45, 20)).message, /向左转/);
  assert.match(guide(direction(90, 72)).message, /抬头/);
  assert.match(guide(direction(270, 20)).message, /转身/);
  assert.match(guide(direction(90, 72), { pose: { ...pose, roll: 90 } }).message, /向右转/);
});

test('moon finder uses current and same-day forward or earlier times and labels flat references', () => {
  const day = getLocalDayBounds('2026-11-12', 'Asia/Shanghai');
  const observer = { latitude: 30.57, longitude: 104.06 };
  const noon = day.startMs + 12 * 3600_000;
  const first = findMoonPreview(day, observer, null, day.startMs);
  assert.equal(first.status, 'found');
  assert.equal(first.relation, 'next');
  assert.equal(first.flatReference, true);
  assert.ok(first.timeMs > day.startMs && first.timeMs < day.endMs);
  assert.ok(getSkyPosition(first.timeMs, observer).moon.altitudeDeg >= 0);
  const current = findMoonPreview(day, observer, level(0), noon);
  assert.equal(current.status, 'found');
  assert.equal(current.relation, 'current');
  assert.equal(current.flatReference, false);
  const last = findMoonPreview(day, observer, level(0), day.endMs - 1);
  assert.equal(last.status, 'found');
  assert.equal(last.relation, 'earlier');
  assert.ok(last.timeMs > noon && last.timeMs < day.endMs);
});

test('a full blocked day differs from missing ridge data', () => {
  const day = getLocalDayBounds('2026-11-12', 'Asia/Shanghai');
  const observer = { latitude: 30.57, longitude: 104.06 };
  assert.equal(findMoonPreview(day, observer, level(90), day.startMs).status, 'none');
  assert.equal(findMoonPreview(day, observer, level(null), day.startMs).status, 'unknown');
});
