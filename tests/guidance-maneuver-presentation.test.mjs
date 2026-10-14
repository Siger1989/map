import test from 'node:test';
import assert from 'node:assert/strict';
import { maneuverKind } from '../modules/guidance/maneuverPresentation.ts';

test('maneuver symbols use only explicit direction and arrival words', () => {
  assert.equal(maneuverKind('前方右转进入辅路'), 'right');
  assert.equal(maneuverKind('向左转'), 'left');
  assert.equal(maneuverKind('前方掉头'), 'uturn');
  assert.equal(maneuverKind('沿路线前进'), 'straight');
  assert.equal(maneuverKind('到达终点'), 'arrival');
  assert.equal(maneuverKind('进入路口后按导航行驶'), 'unknown');
  assert.equal(maneuverKind('请驶入左转车道'), 'unknown', 'lane wording does not imply a turn maneuver');
});
