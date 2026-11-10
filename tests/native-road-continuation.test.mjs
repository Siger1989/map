import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRoadContinuation } from '../modules/map/native/roadContinuation.ts';
import { roadSection, roadSnapResult } from '../modules/tracks/roadSnapping.ts';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';

const project = ([lon, lat]) => ({ x: 50 + (lon - 104) * 10000, y: 200 + (lat - 30) * 10000 });
const line = { id: 'long-real-feature', name: '长弯线', coordinates: Array.from({ length: 201 }, (_, i) =>
  [104 + i * .0001, 30 + Math.sin(i / 10) * .0002]) };
const match = (source, index, fraction) => {
  const coordinate = source.coordinates[index + (fraction === 1 ? 1 : 0)];
  return { line: source, index, fraction, coordinate, screen: project(coordinate) };
};
const start = match(line, 0, 0), end = match(line, 199, 1);

test('explicit points mode retains a real 200-edge curve beyond the freehand 128-point limit', () => {
  assert.equal(roadSection(start, end, project), null, 'reproduces the former native fast-path rejection');
  const path = nativeRoadContinuation(start, end, [line], project, 'points');
  assert.equal(path.status, 'ready');
  assert.deepEqual(path.section, line.coordinates.slice(1));
  assert.equal(nativeRoadContinuation(start, end, [line], project, 'freehand').status, 'disconnected');
  assert.equal(nativeRoadContinuation(start, end, [line], project).status, 'disconnected', 'legacy callers keep their guard');
});

test('a deliberate point-to-point winding path is allowed while freehand hairpin jumps remain rejected', () => {
  const winding = { id: 'winding', name: '', coordinates: [[104, 30], [104, 30.006], [104.0002, 30.006], [104.0002, 30]] };
  const a = match(winding, 0, 0), b = match(winding, 2, 1);
  assert.equal(roadSection(a, b, project), null);
  assert.deepEqual(nativeRoadContinuation(a, b, [winding], project, 'points'), {
    status: 'ready', section: winding.coordinates.slice(1),
  });
  assert.equal(nativeRoadContinuation(a, b, [winding], project, 'freehand').status, 'disconnected');
});

test('road and river points preview and commit every verified bend without a straight crossing fallback', () => {
  for (const strictNetwork of [false, true]) {
    const session = new DrawingSession();
    const options = { mode: 'points', width: 400, height: 800, length: 48, anchor: null, candidates: [],
      snapping: false, roadSnapping: true, strictNetwork, lastVertex: start.coordinate, project,
      unproject: () => end.coordinate,
      snapRoad: (aim, previous, from, mode) => {
        assert.equal(mode, 'points'); assert.equal(previous, null); assert.deepEqual(from, start.coordinate);
        const path = nativeRoadContinuation(start, end, [line], project, mode);
        return roadSnapResult(end, from, path.section, path.status);
      },
    };
    const preview = session.input({ type: 'start', point: { x: end.screen.x, y: end.screen.y + 44 } }, options).preview;
    assert.equal(preview.blocked, false);
    assert.equal(preview.crossing, false);
    assert.equal(preview.snapped, true);
    assert.equal((preview.path.match(/ L /g) ?? []).length, 200);
    const committed = session.input({ type: 'end', reason: 'release' }, options);
    assert.deepEqual(committed.section, line.coordinates.slice(1));
    assert.deepEqual(committed.vertex, end.coordinate);
  }
});

test('freehand requests explicitly retain their separate safety mode', () => {
  const session = new DrawingSession(); let called = false;
  const options = { mode: 'freehand', width: 400, height: 800, length: 48, anchor: start.coordinate, candidates: [],
    snapping: false, roadSnapping: true, project,
    unproject: p => [104 + (p.x - 50) / 10000, 30 + (p.y - 200) / 10000],
    snapRoad: (_aim, _previous, _from, mode) => { called = true; assert.equal(mode, 'freehand'); return { status: 'no-match', match: null }; },
  };
  session.input({ type: 'start', point: { x: 50, y: 248 } }, options);
  session.input({ type: 'move', point: { x: 180, y: 300 } }, options);
  assert.equal(called, true);
});
