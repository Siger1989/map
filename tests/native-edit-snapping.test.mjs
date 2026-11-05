import assert from 'node:assert/strict';
import test from 'node:test';
import { snapNativeEditCoordinate } from '../modules/map/native/editSnapping.ts';

const point = { x: 120, y: 180 };
const match = {
  line: { id: 'road-a', name: '测试路', coordinates: [[104, 30], [104.01, 30.01]] },
  index: 0, fraction: 0.5, coordinate: [104.005, 30.005], screen: point,
};

test('disabled editing network snaps leave raw positioning available without querying data', () => {
  assert.equal(snapNativeEditCoordinate(point, {
    road: false, river: false,
    snapRoad() { assert.fail('road query while disabled'); },
    snapRiver() { assert.fail('river query while disabled'); },
  }), null);
});

test('editing a road node uses the real nearest coordinate without requesting or inventing a route leg', () => {
  const calls = [];
  const result = snapNativeEditCoordinate(point, {
    road: true, river: false,
    snapRoad(...args) { calls.push(args); return { status: 'ready', match }; },
    snapRiver() { assert.fail('wrong geometry kind'); },
  });
  assert.deepEqual(calls, [[point, null]], 'no from coordinate, so moving a node never builds a whole-road network');
  assert.deepEqual(result, { coordinate: match.coordinate, hint: '已吸附道路 · 测试路' });
  assert.equal('snappedNode' in result, false, 'a map road is not a saved-route node');
});

test('river selection uses waterway geometry and a river hint even if both flags briefly overlap', () => {
  const riverMatch = { ...match, line: { ...match.line, id: 'waterway:a', name: '' } };
  const result = snapNativeEditCoordinate(point, {
    road: true, river: true,
    snapRoad() { assert.fail('river selection must not snap to a road'); },
    snapRiver(aim, previous, from) {
      assert.equal(aim, point); assert.equal(previous, null); assert.equal(from, undefined);
      return { status: 'ready', match: riverMatch };
    },
  });
  assert.equal(result.coordinate, riverMatch.coordinate);
  assert.match(result.hint, /河流/);
  assert.doesNotMatch(result.hint, /道路/);
});

test('loading, absent matches and existing graph limits preserve raw position with an honest hint', () => {
  for (const [status, expected] of [
    ['loading', /加载中/], ['unavailable', /不可用/], ['no-match', /附近没有/],
    ['limited', /计算受限/], ['hidden', /已关闭/], ['disconnected', /不连通/],
  ]) {
    const result = snapNativeEditCoordinate(point, {
      road: true, river: false,
      snapRoad: () => ({ status, match: status === 'disconnected' ? match : null }),
      snapRiver() { assert.fail('wrong geometry kind'); },
    });
    assert.equal(result.coordinate, null, status);
    assert.match(result.hint, expected, status);
    assert.doesNotMatch(result.hint, /已吸附/, 'a fallback coordinate must not be reported as a successful match');
  }
});
