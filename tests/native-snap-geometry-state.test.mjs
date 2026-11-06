import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSnapGeometryState } from '../modules/map/native/snapGeometryState.ts';
import { nearestRoad, roadHint } from '../modules/tracks/roadSnapping.ts';
import { roadPath } from '../modules/tracks/roadPath.ts';
import { blockedSnapHint } from '../modules/tracks/DrawingSession.ts';

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

test('same-revision partial coverage keeps a known complete snapshot while it is still loading', () => {
  const lines = [{ id: 'known-road', name: 'Fixture Road', coordinates: [[0, 0], [1, 0]] }];
  const previous = { status: 'ready', lines, coverageComplete: true };
  const retained = nextSnapGeometryState(11, 11, 11, previous, 'partial', [], false);
  assert.strictEqual(retained, previous);
  assert.equal(retained.coverageComplete, true);
  assert.ok(nearestRoad({ x: 50, y: 0 }, retained.lines, project));
});

test('partial snapshots preserve known roads but never claim an incomplete area has no road', () => {
  const line = { id: 'partial-road', name: 'Fixture Road', coordinates: [[0, 0], [1, 0]] };
  const partial = nextSnapGeometryState(12, 12, 12, null, 'partial', [line], false);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.coverageComplete, false);
  assert.strictEqual(partial.lines[0], line);
  assert.ok(nearestRoad({ x: 50, y: 0 }, partial.lines, project), 'known geometry remains usable');
  assert.match(roadHint({ status: 'partial', match: null }), /路网数据未齐/);
  assert.match(blockedSnapHint('partial', false), /数据未齐/);
  assert.match(blockedSnapHint('partial', true), /数据未齐/);

  const retainedPartial = nextSnapGeometryState(12, 12, 12, partial, 'partial', [], false);
  assert.strictEqual(retainedPartial, partial, 'an empty incomplete refresh must not erase previously known roads');

  const noKnownLines = nextSnapGeometryState(12, 12, 12, null, 'partial', null, false);
  assert.equal(noKnownLines.status, 'partial');
  assert.equal(noKnownLines.lines, null);
});

test('new revision partial coverage replaces stale geometry instead of reusing old roads', () => {
  const previous = { status: 'ready', lines: [{ id: 'old', name: '', coordinates: [[0, 0], [1, 0]] }] };
  const partialLines = [{ id: 'current', name: '', coordinates: [[2, 0], [3, 0]] }];
  const next = nextSnapGeometryState(20, 21, 21, previous, 'partial', partialLines, false);
  assert.equal(next.status, 'partial');
  assert.strictEqual(next.lines, partialLines);
  assert.equal(next.coverageComplete, false);
});
