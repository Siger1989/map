import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceNativeFollowGesture, beginNativeFollowGesture } from '../modules/map/native/followGesture.ts';

test('touch down and movement below Android touch slop keep follow active', () => {
  let gesture = beginNativeFollowGesture('g1', { x: 10, y: 10 }, 1);
  assert.equal(gesture.endedFollow, false);
  let result = advanceNativeFollowGesture(gesture, 2, 1, { x: 17, y: 10 }, 8);
  assert.equal(result.endedFollow, false);
  assert.equal(result.gesture.endedFollow, false);
});

test('only a single pointer crossing the supplied Android touch slop ends follow, once', () => {
  let gesture = beginNativeFollowGesture('g1', { x: 10, y: 10 }, 1);
  let result = advanceNativeFollowGesture(gesture, 2, 1, { x: 18.1, y: 10 }, 8);
  assert.equal(result.endedFollow, true);
  assert.equal(result.gesture.endedFollow, true);
  result = advanceNativeFollowGesture(result.gesture, 2, 1, { x: 30, y: 10 }, 8);
  assert.equal(result.endedFollow, false);
});

test('second pointer preempts pan cancellation and view rotations retain follow', () => {
  let gesture = beginNativeFollowGesture('g1', { x: 10, y: 10 }, 1);
  let result = advanceNativeFollowGesture(gesture, 5, 2, { x: 10, y: 10 }, 8);
  assert.equal(result.gesture.multiTouch, true);
  result = advanceNativeFollowGesture(result.gesture, 2, 2, { x: 40, y: 10 }, 8);
  assert.equal(result.endedFollow, false);
  result = advanceNativeFollowGesture(result.gesture, 2, 1, { x: 50, y: 10 }, 8);
  assert.equal(result.endedFollow, false);
});
