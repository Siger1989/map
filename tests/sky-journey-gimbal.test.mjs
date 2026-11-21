import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyGimbal } from '../modules/sky/journeyGimbal.ts';
import { shortestTurn } from '../modules/sky/skyPoseMotion.ts';

test('route camera rounds a sharp corner in playback time with continuous velocity', () => {
  const smooth = createJourneyGimbal(0, 8, t => ({
    coordinates: [Math.min(t, 4) * .001, Math.max(0, t - 4) * .001],
    headingDeg: t < 4 ? 90 : 0,
  }));
  const center = smooth(4);
  assert.ok(center.coordinates[0] < .004 && center.coordinates[1] > 0);
  assert.ok(center.headingDeg > 0 && center.headingDeg < 90);
  for (const time of [3.875, 4, 4.125]) {
    const dt = .00001;
    const left = smooth(time - dt), at = smooth(time), right = smooth(time + dt);
    for (let axis = 0; axis < 2; axis++) {
      const velocityChange = (right.coordinates[axis] - 2 * at.coordinates[axis] + left.coordinates[axis]) / dt;
      assert.ok(Math.abs(velocityChange) < .000001);
    }
    const turnChange = (shortestTurn(at.headingDeg, right.headingDeg) - shortestTurn(left.headingDeg, at.headingDeg)) / dt;
    assert.ok(Math.abs(turnChange) < .01);
  }
});

test('sampling out of order and after knot eviction gives identical poses', () => {
  const make = () => createJourneyGimbal(0, 50, t => ({ coordinates: [-100 + t * .001, 0], headingDeg: t }));
  const smooth = make();
  const sought = smooth(4.75);
  for (let frame = 0; frame < 1200; frame++) smooth(frame / 24);
  assert.deepEqual(smooth(4.75), sought);
});

test('WGS84 longitude and heading use the short arcs near their wrap points', () => {
  const smooth = createJourneyGimbal(0, 6, t => ({
    coordinates: [(179.7 + .1 * t + 180) % 360 - 180, 20],
    headingDeg: t < 3 ? 359 : 1,
  }));
  const pose = smooth(3);
  assert.ok(Math.abs(pose.coordinates[0]) > 179.999);
  assert.ok(Math.abs(shortestTurn(0, pose.headingDeg)) < 1);
});

test('an exact U-turn eases in one signed direction through its midpoint', () => {
  const smooth = createJourneyGimbal(0, 8, t => ({ coordinates: [0, 0], headingDeg: t < 4 ? 0 : 180 }));
  let previous = smooth(3).headingDeg;
  for (let frame = 1; frame <= 48; frame++) {
    const { headingDeg } = smooth(3 + frame / 24);
    const turn = shortestTurn(previous, headingDeg);
    assert.ok(turn <= 1e-9 && turn > -20);
    previous = headingDeg;
  }
  assert.equal(previous, 180);
});

test('the convolution stays within the connected segment and supports a disabled radius', () => {
  const sample = t => {
    assert.ok(7 <= t && t <= 7.25);
    return { coordinates: [t, 0], headingDeg: 90 };
  };
  const smooth = createJourneyGimbal(7, 7.25, sample);
  assert.ok(smooth(7).coordinates[0] < smooth(7.25).coordinates[0]);
  assert.equal(smooth(7).headingDeg, 90);
  const direct = createJourneyGimbal(7, 7.25, sample, 0);
  assert.deepEqual(direct(7.125), sample(7.125));
});
