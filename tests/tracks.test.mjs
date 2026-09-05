import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pullTip,
  parseSavedTracks,
  trackDistance,
} from '../modules/tracks/drawing.ts';
import {
  ringDelta,
  ringAngle,
  clampPitch,
} from '../modules/controls/cameraGesture.ts';
test('杆长缓冲吸收小幅手抖，笔尖保持原位', () => {
  const tip = { x: 100, y: 100 };
  for (const finger of [
    { x: 102, y: 104 },
    { x: 95, y: 110 },
    { x: 130, y: 130 },
  ])
    assert.deepEqual(pullTip(tip, finger, 48), tip);
});
test('拉紧后笔尖在手指后方保持杆长；不能直接跳到手指', () => {
  const tip = pullTip({ x: 0, y: 0 }, { x: 0, y: 100 }, 48);
  assert.deepEqual(tip, { x: 0, y: 52 });
  assert.equal(Math.hypot(tip.x, 100 - tip.y), 48);
});
test('方向逆转先产生空行程，转向不会把抖动立刻画进线', () => {
  const tip = { x: 0, y: 52 };
  assert.deepEqual(pullTip(tip, { x: 0, y: 80 }, 48), tip);
  assert.deepEqual(pullTip(tip, { x: 0, y: 0 }, 48), { x: 0, y: 48 });
});
test('对角牵引不改变方向，笔尖与手指分开', () => {
  const p = pullTip({ x: 0, y: 0 }, { x: 100, y: 100 }, 48);
  assert.ok(Math.abs(Math.hypot(100 - p.x, 100 - p.y) - 48) < 1e-8);
  assert.equal(p.x, p.y);
});
test('多笔距离只累加已画的线，不跨笔补直线', () => {
  const lines = [
    [
      [104, 30],
      [104.001, 30],
    ],
    [
      [105, 31],
      [105.001, 31],
    ],
  ];
  assert.ok(trackDistance(lines) < 200);
});
test('本机轨迹存档往返；坏坐标和空笔被拒绝', () => {
  const track = {
    id: '1',
    name: '山路',
    createdAt: 1,
    segments: [
      [
        [104, 30],
        [104.001, 30],
      ],
    ],
  };
  assert.deepEqual(parseSavedTracks(JSON.stringify([track])), [track]);
  assert.deepEqual(parseSavedTracks(null), []);
  assert.equal(
    parseSavedTracks(
      JSON.stringify([
        {
          ...track,
          segments: [
            [
              [999, 30],
              [104, 30],
            ],
          ],
        },
      ]),
    ).length,
    0,
  );
  assert.throws(() => parseSavedTracks('{'));
});
test('旋转环跨正负180度连续，俯仰限于0至80', () => {
  assert.equal(ringDelta(179, -179), 2);
  assert.equal(ringDelta(-179, 179), -2);
  assert.equal(ringAngle(0, -23), 0);
  assert.equal(ringAngle(46, 0), 90);
  assert.equal(clampPitch(-8), 0);
  assert.equal(clampPitch(95), 80);
});
