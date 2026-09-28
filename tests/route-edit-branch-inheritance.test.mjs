import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendEditBranch,
  selectEditNode,
  startRouteEdit,
  toggleEditBranch,
  undoRouteEdit,
} from '../modules/tracks/routeEdit.ts';

const a = [103, 30];
const b = [103.001, 30];
const c = [103.002, 30];
const d = [103.001, 30.001];
const route = {
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

test('opening a one-point branch preserves existing metadata and adds empty edge rows', () => {
  const initial = startRouteEdit(route);
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
  let active = toggleEditBranch(selectEditNode(startRouteEdit(route), b));
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
  const active = toggleEditBranch(selectEditNode(startRouteEdit(route), b));
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
