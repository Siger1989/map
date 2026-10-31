import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSnapGeometryState } from '../modules/map/native/snapGeometryState.ts';
import { nearestRoad } from '../modules/tracks/roadSnapping.ts';
import { roadPath } from '../modules/tracks/roadPath.ts';

const project = ([lng, lat]) => ({ x: lng * 100, y: lat * 100 });

test('same-current-revision tile loading retains ready road-array identity and usable network', () => {
  const road = {
    id: 'fixture-curved-road',
    name: '',
    coordinates: [[0, 0], [1, 0], [1, 1], [2, 1]],
  };
  const lines = [road];
  const previous = { status: 'ready', lines };
  const start = nearestRoad({ x: 25, y: 0 }, lines, project);
  const end = nearestRoad({ x: 150, y: 100 }, lines, project);
  assert.ok(start);
  assert.ok(end);
  const originalPath = roadPath(start, end, lines);
  assert.ok(originalPath?.length >= 3);

  const retained = nextSnapGeometryState(41, 41, 41, previous, 'loading', []);
  assert.strictEqual(retained, previous);
  assert.strictEqual(retained.lines, lines);
  const retainedStart = nearestRoad({ x: 25, y: 0 }, retained.lines, project);
  const retainedEnd = nearestRoad({ x: 150, y: 100 }, retained.lines, project);
  assert.ok(retainedStart);
  assert.ok(retainedEnd);
  assert.deepEqual(roadPath(retainedStart, retainedEnd, retained.lines), originalPath);
});

test('new revisions and explicit non-loading states invalidate old road and river snapshots', () => {
  const lines = [{ id: 'cached-line', name: '', coordinates: [[0, 0], [1, 0]] }];
  const previous = { status: 'ready', lines };
  const invalidatingCases = [
    { previousRevision: 41, frameRevision: 42, incomingRevision: 42, status: 'loading' },
    { previousRevision: 41, frameRevision: 41, incomingRevision: null, status: 'loading' },
    { previousRevision: 41, frameRevision: 42, incomingRevision: 41, status: 'loading' },
    ...['hidden', 'blocked', 'missing'].map((status) => ({
      previousRevision: 41, frameRevision: 41, incomingRevision: 41, status,
    })),
  ];

  for (const state of invalidatingCases) {
    const next = nextSnapGeometryState(
      state.previousRevision, state.frameRevision, state.incomingRevision,
      previous, state.status, [],
    );
    assert.equal(next.status, state.status);
    assert.equal(next.lines, null);
  }

  const newLines = [{ id: 'replacement', name: '', coordinates: [[2, 0], [3, 0]] }];
  const replacement = nextSnapGeometryState(41, 41, 41, previous, 'ready', newLines);
  assert.equal(replacement.status, 'ready');
  assert.strictEqual(replacement.lines, newLines);
  assert.notStrictEqual(replacement.lines, lines);
});

test('same-revision loading does not retain absent or empty previous geometry', () => {
  assert.deepEqual(
    nextSnapGeometryState(9, 9, 9, { status: 'loading', lines: null }, 'loading', []),
    { status: 'loading', lines: null },
  );
  assert.deepEqual(
    nextSnapGeometryState(9, 9, 9, { status: 'ready', lines: [] }, 'loading', []),
    { status: 'loading', lines: null },
  );
});
