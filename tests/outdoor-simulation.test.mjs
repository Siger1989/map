import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFix, createSimulationGeoApi, interpolateLoop, makeSimFix, normalizeHeading, playbackDistance, SIM_SPEEDS } from '../modules/position/simulation.ts';

test('simulation validates coordinates and normalizes compass headings', () => {
  assert.equal(normalizeHeading(-90), 270);
  assert.equal(makeSimFix(104, 30, 1.4, 360).heading, 0);
  assert.throws(() => makeSimFix(181, 30, 1, 0), /经纬度无效/);
  assert.throws(() => makeSimFix(104, 91, 1, 0), /经纬度无效/);
});

test('walk, run, cycle speeds and paused zero-speed movement are explicit', () => {
  assert.deepEqual(SIM_SPEEDS, { walk: 1.4, run: 3, cycle: 6 });
  const start = makeSimFix(0, 0, 0, 90, 5, 100);
  const paused = advanceFix(start, 0, 90, 0, 200);
  assert.deepEqual(paused, { ...start, timestamp: 200 });
  const moved = advanceFix(start, 6, 90, 3, 300);
  assert.ok(moved.longitude > start.longitude);
  assert.equal(moved.speed, 3);
  assert.equal(moved.timestamp, 300);
});

test('route distance stops while paused, resumes without a jump, and caps background elapsed time', () => {
  const afterStart = playbackDistance(10, 3, 1000, true);
  const whilePaused = playbackDistance(afterStart, 3, 30000, false);
  const afterResume = playbackDistance(whilePaused, 3, 1000, true);
  const afterBackground = playbackDistance(afterResume, 3, 60000, true);
  assert.equal(afterStart, 13);
  assert.equal(whilePaused, 13);
  assert.equal(afterResume, 16);
  assert.equal(afterBackground, 19);
});

test('route playback interpolates by meters and reports the segment heading', () => {
  const points = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]];
  const east = interpolateLoop(points, 55.66);
  assert.ok(east.point[0] > 0 && east.point[0] < 0.001);
  assert.ok(Math.abs(east.heading - 90) < 1);
  const next = interpolateLoop(points, 55.66 + 55.66 + 55.66);
  assert.ok(next.point[1] > 0 && next.point[1] < 0.001);
  assert.ok(Math.abs(next.heading) < 1);
});

test('geolocation mock supports independent watches, getCurrentPosition, loss and clearWatch', () => {
  const geo = createSimulationGeoApi(), first = [], second = [], errors = [], current = [];
  const a = geo.watchPosition(p => first.push(p), e => errors.push(e));
  const b = geo.watchPosition(p => second.push(p));
  assert.equal(geo.count(), 2);
  const fix = { coords: { longitude: 104, latitude: 30, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: 90, speed: 1.4 }, timestamp: 100 };
  geo.publish(fix);
  geo.getCurrentPosition(p => current.push(p));
  geo.clearWatch(a);
  geo.publish({ ...fix, timestamp: 200 });
  geo.lose();
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  assert.equal(current.length, 1);
  assert.equal(errors[0].code, 3);
  assert.equal(geo.count(), 1);
  geo.clearWatch(b);
  assert.equal(geo.count(), 0);
});
