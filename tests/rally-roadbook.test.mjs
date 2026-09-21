import test from 'node:test';
import assert from 'node:assert/strict';
import { roadbookNotes, turnKind, fixSpeed } from '../modules/rally/roadbook.ts';
const route = { distance: 600, steps: [
  { instruction: '出发', distance: 100 }, { instruction: '左转', distance: 200 },
  { instruction: '右转', distance: 300 }, { instruction: '到达终点', distance: 0 },
] };
test('cue distances are to next instruction then between subsequent instructions', () => {
  assert.deepEqual(roadbookNotes(route, 50, 600).map(n => [n.text, n.distance]), [['左转', 50], ['右转', 200], ['到达终点', 300]]);
  assert.equal(roadbookNotes(route, 105, 600)[0].text, '右转');
  assert.deepEqual(roadbookNotes(route, 600, 600), []);
});
test('icon classification never invents an unknown turn direction', () => {
  assert.equal(turnKind('右侧掉头'), 'uturn-right');
  assert.equal(turnKind('进入环岛，从第三出口驶出'), 'unknown');
  assert.equal(turnKind('左转进入道路'), 'left');
  assert.equal(turnKind('到达道路出口，继续前往标记点'), 'straight');
  assert.equal(turnKind('离开道路前往终点 · 虚线直连示意'), 'unknown');
  assert.equal(turnKind('到达终点'), 'finish');
});
test('speed requires fresh fixes and rejects stale, same-time and jumping positions', () => {
  const a = { coordinates: [103, 30], accuracy: 5, timestamp: 100000 };
  const b = { coordinates: [103.0001, 30], accuracy: 5, timestamp: 105000 };
  assert.equal(fixSpeed(null, b, 'bicycle', 105000), null);
  assert.equal(fixSpeed(a, b, 'bicycle', 150000), null);
  assert.equal(fixSpeed(a, a, 'bicycle', 100000), null);
  assert.equal(fixSpeed(a, { ...b, coordinates: [104, 31] }, 'bicycle', 105000), null);
  assert.ok(fixSpeed(a, b, 'bicycle', 105000) > 5);
});
