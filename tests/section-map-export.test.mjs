import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profileMapData,
  profileCoordinateRows,
} from '../modules/section/profileMapData.ts';
const settings = {
  enabled: true,
  altitude: 600,
  color: '#9de8c4',
  plane: { center: [104, 31], width: 1000, height: 2000, heading: 0, tilt: 0 },
};
const cursor = {
  u: 0,
  v: 0,
  local: [0, 0, 0],
  coordinates: [104, 31],
  altitude: 600,
  distance: 0,
};
test('vertical plane projects to a line with coincident upper/lower corners but distinct altitudes', () => {
  const plan = profileMapData({ settings, curves: [] }, cursor, []);
  assert.equal(plan.points.length, 5);
  assert.deepEqual(
    plan.corners[0].point.coordinates,
    plan.corners[3].point.coordinates,
  );
  assert.equal(
    plan.corners[0].point.altitude - plan.corners[3].point.altitude,
    2000,
  );
  assert.equal(plan.corners[0].point.u, -500);
  assert.match(
    profileCoordinateRows(plan.points)[4][1],
    /经度 104.0000000°，纬度 31.0000000°/,
  );
});
test('tilted/rolled plane and all saved measurements share one immutable snapshot and numbering', () => {
  const data = {
    settings: {
      ...settings,
      plane: { ...settings.plane, tilt: 40, roll: 30, center: [179.999, 31] },
    },
    curves: [],
  };
  const note = {
      name: '采样点',
      point: { ...cursor, coordinates: [-179.999, 31] },
      color: '#abcdef',
    },
    before = structuredClone(data);
  const plan = profileMapData(data, cursor, [note]);
  assert.deepEqual(data, before);
  assert.equal(plan.points[5].label, '1');
  assert.equal(plan.points[5].color, '#abcdef');
  assert.equal(profileCoordinateRows(plan.points).length, 6);
  assert.notDeepEqual(
    plan.corners[0].point.coordinates,
    plan.corners[3].point.coordinates,
  );
  const local = profileMapData(data, note.point, [note]);
  assert.ok(local.bounds[1][0] - local.bounds[0][0] < 1);
});
