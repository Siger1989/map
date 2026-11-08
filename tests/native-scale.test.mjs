import assert from 'node:assert/strict';
import test from 'node:test';
import { groundDistanceMeters, makeMapScaleMark } from '../modules/map/native/scale.ts';

test('native scale marks use real 1/2/5 distances and never exceed their measured screen span', () => {
  const mark = makeMapScaleMark(327, 72);
  assert.equal(mark.label, '200 m');
  assert.equal(mark.meters, 200);
  assert.ok(Math.abs(mark.width - 44.0367) < 0.001);
  const kilometre = makeMapScaleMark(4200, 72);
  assert.equal(kilometre.label, '2 km');
  assert.ok(kilometre.width <= 72);
  assert.equal(makeMapScaleMark(null), null);
  assert.equal(makeMapScaleMark(Number.NaN), null);
  assert.equal(makeMapScaleMark(0), null);
  assert.equal(makeMapScaleMark(100, 0), null);
});

test('ground distance follows latitude and wraps longitude at the antimeridian', () => {
  const equator = groundDistanceMeters([0, 0], [1, 0]);
  const highLatitude = groundDistanceMeters([0, 80], [1, 80]);
  const acrossDateline = groundDistanceMeters([179.5, 0], [-179.5, 0]);
  assert.ok(equator && Math.abs(equator - 111195) < 100);
  assert.ok(highLatitude && highLatitude < equator * 0.18);
  assert.ok(acrossDateline && Math.abs(acrossDateline - 111195) < 100);
  assert.equal(groundDistanceMeters([0, 91], [1, 90]), null);
});
