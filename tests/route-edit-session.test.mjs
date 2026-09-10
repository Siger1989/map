import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startRouteEdit,
  selectEditNode,
  moveEditNode,
  toggleEditBranch,
  appendEditBranch,
  undoRouteEdit,
  styleRouteEdit,
  storeRouteEdit,
} from '../modules/tracks/routeEdit.ts';
import { TRACK_STORAGE, parseSavedTracks } from '../modules/tracks/drawing.ts';
import { photosForTrack } from '../modules/photos/trackPhotos.ts';
const a = {
  id: 'a',
  name: '原路',
  createdAt: 1,
  source: 'manual',
  segments: [
    [
      [103, 30],
      [103.001, 30],
      [103.002, 30],
    ],
  ],
  style: { color: '#ffb477', width: 1.5, opacity: 1 },
};
const b = {
  id: 'b',
  name: '目标线',
  createdAt: 1,
  source: 'gpx',
  segments: [
    [
      [103.001, 30.002],
      [103.003, 30.002],
    ],
  ],
};
function archive(records) {
  let value = JSON.stringify(records);
  let writes = 0;
  return {
    getItem: (key) => (key === TRACK_STORAGE ? value : null),
    setItem: (_key, next) => {
      value = next;
      writes++;
    },
    read: () => parseSavedTracks(value),
    writes: () => writes,
  };
}
test('node and style edits stay in memory until a single explicit save', () => {
  const disk = archive([a]);
  let s = startRouteEdit(a);
  s = moveEditNode(s, a.segments[0][1], [103.001, 30.001]);
  s = styleRouteEdit(s, { color: '#55d6ff', width: 3, opacity: 0.8 });
  assert.deepEqual(disk.read()[0].segments, a.segments);
  assert.equal(disk.writes(), 0);
  const result = storeRouteEdit(s, disk, 'unused', 2);
  assert.equal(result.track.id, 'a');
  assert.equal(result.track.style.width, 3);
  assert.equal(disk.writes(), 1);
  assert.deepEqual(a.segments[0][1], [103.001, 30]);
});
test('branch can rejoin an old node without removing the old interval', () => {
  let s = toggleEditBranch(selectEditNode(startRouteEdit(a), a.segments[0][0]));
  s = appendEditBranch(s, [103.001, 29.999]);
  s = appendEditBranch(s, a.segments[0][2]);
  assert.equal(s.branch, null);
  assert.deepEqual(s.track.segments[0], a.segments[0]);
  assert.deepEqual(s.track.segments[1], [
    a.segments[0][0],
    [103.001, 29.999],
    a.segments[0][2],
  ]);
});
test('snapping a branch to another route only adds an endpoint; other archive and photo ownership stay unchanged', () => {
  const disk = archive([a, b]);
  let s = toggleEditBranch(selectEditNode(startRouteEdit(a), a.segments[0][1]));
  s = appendEditBranch(s, b.segments[0][0], b);
  assert.equal(disk.writes(), 0);
  assert.equal(disk.read().length, 2);
  const result = storeRouteEdit(s, disk, 'combined', 2);
  assert.deepEqual(result.track.sourceTrackIds, []);
  assert.equal(disk.writes(), 1);
  assert.ok(
    disk
      .read()
      .filter((t) => ['a', 'b'].includes(t.id))
      .every((t) => !t.hidden),
  );
  assert.equal(disk.read().filter((t) => !t.hidden).length, 2);
  assert.deepEqual(disk.read().find(t => t.id === 'b'), b);
  assert.equal(result.track.segments.length, 2);
  const photos = [
    { id: 'p1', trackId: 'a', time: 1 },
    { id: 'p2', trackId: 'b', time: 2 },
    { id: 'p3', trackId: 'other', time: 3 },
  ];
  assert.deepEqual(
    photosForTrack(result.track, photos).map((p) => p.id),
    ['p1'],
  );
  assert.equal(photos[1].trackId, 'b');
});
test('undo cross-route connection removes imported geometry and source visibility changes', () => {
  const disk = archive([a, b]);
  let s = toggleEditBranch(selectEditNode(startRouteEdit(a), a.segments[0][1]));
  s = appendEditBranch(s, b.segments[0][0], b);
  s = undoRouteEdit(s);
  s = undoRouteEdit(s);
  assert.equal(s.sources.length, 1);
  assert.deepEqual(s.track.segments, a.segments);
  storeRouteEdit(s, disk, 'unused', 2);
  assert.ok(disk.read().every((t) => !t.hidden));
});
test('incomplete branch and storage failure leave original geometry and visibility intact', () => {
  const disk = archive([a, b]);
  let s = toggleEditBranch(selectEditNode(startRouteEdit(a), a.segments[0][1]));
  assert.throws(() => storeRouteEdit(s, disk, 'combined', 2), /分叉还没有完成/);
  s = appendEditBranch(s, b.segments[0][0], b);
  assert.throws(
    () =>
      storeRouteEdit(
        s,
        {
          getItem: disk.getItem,
          setItem: () => {
            throw new Error('quota');
          },
        },
        'combined',
        2,
      ),
    /quota/,
  );
  assert.equal(disk.writes(), 0);
  assert.equal(disk.read().length, 2);
  assert.ok(disk.read().every((t) => !t.hidden));
});
test('stale edit fails instead of overwriting a newer route', () => {
  const disk = archive([{ ...a, updatedAt: 10, name: '别处修改' }]);
  assert.throws(
    () => storeRouteEdit(startRouteEdit(a), disk, 'x', 11),
    /其他窗口更新/,
  );
  assert.equal(disk.writes(), 0);
});

test('route editor copies beyond 20, refuses the 101st and preserves concurrent colour notes', () => {
  const recorded = {...b,source:'recorded'};
  const records = [recorded, ...Array.from({length:19}, (_,i)=>({...a,id:`other-${i}`}))];
  const disk = archive(records);
  assert.equal(storeRouteEdit(startRouteEdit(recorded),disk,'copy',2).records.length,21);
  const full = archive([recorded,...Array.from({length:99},(_,i)=>({...a,id:`full-${i}`}))]);
  assert.throws(()=>storeRouteEdit(startRouteEdit(recorded),full,'overflow',2),/100条/);
  assert.equal(full.writes(),0);
  const changed = archive([{...a,colorConditions:{'#ffb477':'新备注'}}]);
  assert.throws(()=>storeRouteEdit(startRouteEdit(a),changed,'unused',2),/其他窗口更新/);
  assert.equal(changed.writes(),0);
});
test('hidden and source metadata survive reload, legacy records remain visible', () => {
  const disk = archive([
    a,
    { ...b, hidden: true, sourceTrackIds: ['a', null, 'a'] },
  ]);
  const records = disk.read();
  assert.equal(records[0].hidden, undefined);
  assert.equal(records[1].hidden, true);
  assert.deepEqual(records[1].sourceTrackIds, ['a']);
});

test('precision branch road section is one undo step and keeps original nodes', () => {
  let s = toggleEditBranch(selectEditNode(startRouteEdit(a), a.segments[0][1]));
  const before = s;
  const end = a.segments[0][2];
  const path = [[103.001, 30.001], [103.002, 30.001], end];
  s = appendEditBranch(s, end, undefined, path);
  assert.deepEqual(s.track.segments[0], a.segments[0]);
  assert.deepEqual(s.track.segments[1], [a.segments[0][1], ...path]);
  assert.equal(s.branch, null);
  assert.equal(s.history.length, before.history.length + 1);
  assert.deepEqual(undoRouteEdit(s).track, before.track);
});
test('precision section can connect another route without repeating the starting point', () => {
  const s = toggleEditBranch(
    selectEditNode(startRouteEdit(a), a.segments[0][0]),
  );
  const point = b.segments[0][0];
  const next = appendEditBranch(s, point, b, [
    a.segments[0][0],
    [103, 30.001],
    point,
  ]);
  assert.equal(next.track.segments[1].length, 3);
  assert.equal(next.sources.length, 1);
  assert.equal(next.branch, null);
  assert.equal(undoRouteEdit(next).sources.length, 1);
});
