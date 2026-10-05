import assert from 'node:assert/strict';
import test from 'node:test';
import { appendEditBranch, selectEditNode, startRouteEdit, toggleEditBranch, undoRouteEdit } from '../modules/tracks/routeEdit.ts';
import { inheritEdgeColors } from '../modules/tracks/edgeColors.ts';
import { inheritTrackDetails } from '../modules/tracks/selectionDetails.ts';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style.ts';

const clone = (value) => structuredClone(value);
const a = [103, 30];
const b = [103.001, 30];
const c = [103.002, 30];
const d = [103.001, 30.001];
const originalRoute = {
  id: 'branch-details',
  name: '带元数据的路线',
  createdAt: 1,
  source: 'manual',
  segments: [[a, b, c]],
  nodes: [a, b, c],
  style: { color: '#112233', width: 2, opacity: 1 },
  edgeColors: [['#aabbcc', '#ddeeff']],
  edgeNotes: [['第一段备注', null]],
  pointDetails: { '103,30': { color: '#123456', note: '起点说明' } },
};
const route = (overrides = {}) => ({
  id: 'source', name: 'source', createdAt: 0,
  style: { ...DEFAULT_TRACK_STYLE, color: '#aabbcc' },
  segments: [[[0, 0], [0.001, 0], [0.002, 0]]],
  edgeColors: [['#123456', null]],
  edgeNotes: [[null, 'inherited edge note']],
  pointDetails: { '0,0': { note: 'start detail' }, '0.002,0': { color: '#abcdef' } },
  ...overrides,
});

test('opening a one-point branch preserves existing metadata and adds empty edge rows', () => {
  const initial = startRouteEdit(originalRoute);
  const opened = toggleEditBranch(selectEditNode(initial, b));
  assert.deepEqual(opened.track.segments, [[a, b, c], [b]]);
  assert.equal(opened.track.edgeColors[0], initial.track.edgeColors[0]);
  assert.deepEqual(opened.track.edgeColors[1], []);
  assert.equal(opened.track.edgeNotes[0], initial.track.edgeNotes[0]);
  assert.deepEqual(opened.track.edgeNotes[1], []);
  assert.equal(opened.track.pointDetails, initial.track.pointDetails);
  assert.equal(opened.track.nodes, initial.track.nodes);
  assert.equal(undoRouteEdit(opened).branch, null);
  assert.deepEqual(undoRouteEdit(opened).track.segments, [[a, b, c]]);
});

test('ending an effective branch keeps metadata references and undo restores the active branch', () => {
  let active = toggleEditBranch(selectEditNode(startRouteEdit(originalRoute), b));
  active = appendEditBranch(active, d);
  const colors = active.track.edgeColors;
  const notes = active.track.edgeNotes;
  const details = active.track.pointDetails;
  const nodes = active.track.nodes;
  const ended = toggleEditBranch(active);
  assert.equal(ended.branch, null);
  assert.equal(ended.track.edgeColors, colors);
  assert.equal(ended.track.edgeNotes, notes);
  assert.equal(ended.track.pointDetails, details);
  assert.equal(ended.track.nodes, nodes);
  const restored = undoRouteEdit(ended);
  assert.equal(restored.branch, active.branch);
  assert.deepEqual(restored.track.segments, active.track.segments);
});

test('ending an empty branch removes only its empty metadata rows and remains undoable', () => {
  const active = toggleEditBranch(selectEditNode(startRouteEdit(originalRoute), b));
  const ended = toggleEditBranch(active);
  assert.equal(ended.branch, null);
  assert.deepEqual(ended.track.segments, [[a, b, c]]);
  assert.equal(ended.track.edgeColors[0], active.track.edgeColors[0]);
  assert.deepEqual(ended.track.edgeColors, [active.track.edgeColors[0]]);
  assert.equal(ended.track.edgeNotes[0], active.track.edgeNotes[0]);
  assert.deepEqual(ended.track.edgeNotes, [active.track.edgeNotes[0]]);
  assert.equal(ended.track.pointDetails, active.track.pointDetails);
  assert.equal(ended.track.nodes, active.track.nodes);
  const restored = undoRouteEdit(ended);
  assert.equal(restored.branch, active.branch);
  assert.deepEqual(restored.track.segments, active.track.segments);
});

function expectLegacyEquivalent(before, actual) {
  const expectedDetails = inheritTrackDetails(actual.track.segments, [before.track]);
  const expectedColors = inheritEdgeColors(actual.track.segments, [before.track]);
  assert.deepEqual(actual.track.pointDetails, expectedDetails.pointDetails, 'point details match the established inheritance function');
  assert.deepEqual(actual.track.edgeNotes, expectedDetails.edgeNotes, 'edge notes match the established inheritance function');
  assert.deepEqual(actual.track.edgeColors, expectedColors, 'edge colors match the established inheritance function');
}

test('incremental branch metadata matches legacy exact, reversed, 15 cm boundary, and fallback behavior', () => {
  const fixtures = [
    { point: [0.002, 0], name: 'exact overlap reuses null-edge style fallback' },
    { point: [0, 0], name: 'reversed overlap retains physical edge color and note' },
    { point: [0.0020005, 0], name: '14 cm endpoint drift inherits the source edge' },
    { point: [0.002002, 0], name: 'over 15 cm endpoint drift does not inherit that edge' },
  ];
  for (const fixture of fixtures) {
    let session = toggleEditBranch(selectEditNode(startRouteEdit(route()), [0.001, 0]));
    const before = session;
    const actual = appendEditBranch(session, fixture.point);
    expectLegacyEquivalent(before, actual);
    assert.notEqual(actual, before, fixture.name);
  }
});

test('each successive append matches a fresh legacy rescan and preserves undo snapshots', () => {
  let session = toggleEditBranch(selectEditNode(startRouteEdit(route()), [0.001, 0]));
  const snapshots = [];
  for (const point of [[0.003, 0], [0.004, 0], [0.005, 0]]) {
    const before = session;
    snapshots.push(clone(session.track));
    session = appendEditBranch(session, point);
    expectLegacyEquivalent(before, session);
  }
  assert.ok(snapshots[0].segments.length > 0, 'snapshot captured the route and empty branch');
  let undone = session;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    undone = undoRouteEdit(undone);
    assert.deepEqual(undone.track, snapshots[i], `undo restores append state ${i}`);
  }
});

test('a snap target only closes the branch and does not contribute its metadata', () => {
  const source = route({ edgeColors: undefined, edgeNotes: undefined });
  const target = route({
    id: 'target', segments: [[[0.002, 0], [0.003, 0]]],
    edgeColors: [['#ff0000']], edgeNotes: [['target-only note']],
    pointDetails: { '0.003,0': { note: 'target-only detail' } },
  });
  const before = toggleEditBranch(selectEditNode(startRouteEdit(source), [0.001, 0]));
  const actual = appendEditBranch(before, [0.003, 0], target);
  expectLegacyEquivalent(before, actual);
  assert.equal(actual.track.edgeNotes?.[1]?.[1] ?? null, null);
  assert.notEqual(actual.track.pointDetails?.['0.003,0']?.note, 'target-only detail');
  assert.equal(actual.branch, null, 'snapping to the target endpoint completes the branch');
});

test('duplicate physical edges fall back to the legacy last-color and last-note behavior', () => {
  const duplicate = route({
    segments: [[[0, 0], [0.001, 0]], [[0.001, 0], [0, 0]]],
    edgeColors: [['#111111'], ['#222222']],
    edgeNotes: [['first note'], ['last note']],
    pointDetails: { '0,0': { note: 'point' } },
  });
  const before = toggleEditBranch(selectEditNode(startRouteEdit(duplicate), [0.001, 0]));
  const actual = appendEditBranch(before, [0, 0]);
  expectLegacyEquivalent(before, actual);
  assert.equal(actual.track.edgeColors.at(-1)?.[0], '#222222');
  assert.equal(actual.track.edgeNotes.at(-1)?.[0], 'last note');
});

test('a multi-edge section inherits every edge from the prior snapshot only', () => {
  const before = toggleEditBranch(selectEditNode(startRouteEdit(route()), [0.001, 0]));
  const section = [[0.001, 0], [0.003, 0], [0.004, 0]];
  const actual = appendEditBranch(before, section.at(-1), undefined, section);
  expectLegacyEquivalent(before, actual);
});

test('6000 vertex branch snapshots reuse an index and keep every step immutable', () => {
  const points = Array.from({ length: 5900 }, (_, i) => [i * 0.00001, 0]);
  const long = route({ segments: [points], edgeColors: [Array(points.length - 1).fill('#135790')], edgeNotes: [Array(points.length - 1).fill(null)] });
  let session = toggleEditBranch(selectEditNode(startRouteEdit(long), points.at(-1)));
  const prior = clone(session.track);
  const next = appendEditBranch(session, [0.1, 0.01]);
  expectLegacyEquivalent(session, next);
  assert.deepEqual(session.track, prior, 'the prior track snapshot remains untouched');
  assert.equal(next.track.segments.flat().length, 5902);
});
