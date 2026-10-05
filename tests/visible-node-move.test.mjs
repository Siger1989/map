import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVisibleNodeMove, moves, applyTrackVisibleNodeMove } from '../modules/tracks/visibleNodeMove.ts';
import { startRouteEdit, moveEditNode, undoRouteEdit, addEditMarker } from '../modules/tracks/routeEdit.ts';
import { metresBetween } from '../modules/navigation/types.ts';

const pt = (x, y = 0) => [x, y];
const route = (segments, extra = {}) => ({ id: 'r', name: 'r', source: 'manual', createdAt: 1, segments, style: { color: '#123456', width: 2 }, ...extra });
const straight = (a, b, p, q) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < 1e-10 && Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) < 1e-10;

test('straightens both sides of a moved node between visible anchors', () => {
  const a = pt(0, 0), h1 = pt(1, 1), b = pt(2, 0), h2 = pt(3, -1), c = pt(4, 0), to = pt(2, 2);
  const original = route([[a, h1, b, h2, c]]);
  const plan = prepareVisibleNodeMove(original.segments, b, [a, b, c]);
  const moved = applyTrackVisibleNodeMove(original, plan, to);
  assert.equal(moved.segments[0].length, 5);
  assert.deepEqual(moved.segments[0][0], a);
  assert.deepEqual(moved.segments[0][4], c);
  assert.deepEqual(moved.segments[0][2], to);
  assert.ok(straight(a, to, moved.segments[0][1], moved.segments[0][2]));
  assert.ok(straight(to, c, moved.segments[0][2], moved.segments[0][3]));
});

test('segment endpoints and shared junctions stay fixed, repeated moved coordinates stay joined', () => {
  const a = pt(0), x = pt(1, 1), b = pt(2), c = pt(4), y = pt(3, 2), d = pt(6);
  const untouched = [pt(10), pt(11)];
  const original = route([[a, x, b, y, c], [b, d], untouched]);
  const plan = prepareVisibleNodeMove(original.segments, b, [a, c, d]);
  const changed = applyTrackVisibleNodeMove(original, plan, pt(2, 1));
  assert.deepEqual(changed.segments[0][0], a);
  assert.deepEqual(changed.segments[0].at(-1), c);
  assert.deepEqual(changed.segments[1][0], pt(2, 1));
  assert.deepEqual(changed.segments[0][2], changed.segments[1][0]);
  assert.equal(changed.segments[2], untouched);
});

test('a moved segment endpoint straightens the available one-sided span', () => {
  const b = pt(0), h1 = pt(1, 1), h2 = pt(2, -1), c = pt(4), to = pt(0, 2);
  const original = route([[b, h1, h2, c]]);
  const plan = prepareVisibleNodeMove(original.segments, b, [c]);
  assert.equal(plan.spans.length, 1);
  const changed = applyTrackVisibleNodeMove(original, plan, to);
  assert.deepEqual(changed.segments[0][0], to);
  assert.deepEqual(changed.segments[0].at(-1), c);
  assert.ok(straight(to, c, changed.segments[0][1], changed.segments[0][2]));
});

test('consecutive recorded duplicate vertices stay duplicated while their shared coordinates move without a spike', () => {
  const a = pt(0), h1 = pt(1, 1), b = pt(2), h2 = pt(3, -1), c = pt(4), to = pt(2, 2);
  const original = route([[a, h1, [...h1], b, [...b], h2, [...h2], c]]);
  const plan = prepareVisibleNodeMove(original.segments, b, [a, b, c]);
  const changed = applyTrackVisibleNodeMove(original, plan, to);
  assert.equal(changed.segments[0].length, original.segments[0].length);
  assert.deepEqual(changed.segments[0][1], changed.segments[0][2]);
  assert.deepEqual(changed.segments[0][3], changed.segments[0][4]);
  assert.deepEqual(changed.segments[0][5], changed.segments[0][6]);
  assert.deepEqual(changed.segments[0][3], to);
  assert.ok(straight(a, to, changed.segments[0][1], to));
  assert.ok(straight(to, c, changed.segments[0][4], changed.segments[0][5]));
});

test('same coordinate is a no-op and undo restores the exact original route snapshot', () => {
  const a = pt(0), b = pt(1), c = pt(2), original = route([[a, pt(0.5, 1), b, pt(1.5, -1), c]]);
  const editing = startRouteEdit(original);
  const plan = prepareVisibleNodeMove(editing.track.segments, b, [a, b, c]);
  assert.equal(moves(plan, b).size, 0);
  assert.equal(applyTrackVisibleNodeMove(editing.track, plan, b), editing.track);
  const session = moveEditNode(editing, b, pt(1, 2), undefined, plan);
  assert.deepEqual(undoRouteEdit(session).track.segments, original.segments);
});

test('edge metadata indices remain fixed and point details, nodes, terminals, shared stops, and markers follow the geometry', () => {
  const a = pt(0), h = pt(1, 1), b = pt(2), c = pt(4), to = pt(2, 2);
  const original = route([[a, h, b, c]], {
    edgeColors: [['#111111', '#222222', '#333333']], edgeNotes: [[null, 'b edge', 'c edge']],
    pointDetails: { [h.join(',')]: { note: 'hidden' }, [b.join(',')]: { color: '#abcdef', note: 'node' } },
    nodes: [b], routeTerminals: { start: b, end: c },
    sharedRoute: { stops: [{ name: 'stop', coordinates: h }], duration: 3, tolerance: 4 },
  });
  let session = addEditMarker(startRouteEdit(original), h, { name: 'm', note: '', color: '#abcdef', icon: 'pin' }, 'm', null);
  session = { ...session, track: { ...session.track, sharedRoute: original.sharedRoute } };
  const plan = prepareVisibleNodeMove(session.track.segments, b, [a, b, c]);
  const beforeMove = session;
  session = moveEditNode(session, b, to, undefined, plan);
  const moved = session.track, movedH = moved.segments[0][1];
  assert.deepEqual(moved.edgeColors, original.edgeColors);
  assert.deepEqual(moved.edgeNotes, original.edgeNotes);
  assert.deepEqual(moved.pointDetails[movedH.join(',')], { note: 'hidden' });
  assert.deepEqual(moved.pointDetails[to.join(',')], { color: '#abcdef', note: 'node' });
  assert.deepEqual(moved.nodes, [to]);
  assert.deepEqual(moved.routeTerminals, { start: to, end: c });
  assert.deepEqual(moved.sharedRoute.stops[0].coordinates, movedH);
  assert.equal(moved.sharedRoute.duration, null);
  assert.deepEqual(session.pendingMarkers[0].coordinates, movedH);
  assert.deepEqual(undoRouteEdit(session).track, beforeMove.track);
});

test('zero-length distance falls back to index ratios and dateline uses the short longitude arc', () => {
  const a = pt(0), near = pt(Number.MIN_VALUE), b = pt(Number.MIN_VALUE * 2), c = pt(Number.MIN_VALUE * 3);
  assert.equal(metresBetween(a, near) + metresBetween(near, b) + metresBetween(b, c), 0);
  const tiny = route([[a, near, b, c]]), plan = prepareVisibleNodeMove(tiny.segments, b, [a, b, c]);
  assert.deepEqual(plan.spans[0].ratios, [0, 1 / 2, 1]);
  const west = pt(179), hidden = pt(179.5), dragged = pt(180), east = pt(-179), date = route([[west, hidden, dragged, east]]);
  const datePlan = prepareVisibleNodeMove(date.segments, dragged, [west, east]);
  const mapped = moves(datePlan, pt(-179.8, 2)).get(hidden.join(','));
  assert.ok(Math.abs(mapped[0] - 179.6) < 1e-8);
  assert.equal(mapped[1], 1);
});

test('missing, invalid, and stale plans fail safely; repeated loop vertices do not collapse', () => {
  const a = pt(0), b = pt(1), c = pt(2), original = route([[a, b, c, b, a]]);
  assert.equal(prepareVisibleNodeMove(original.segments, pt(9), [a, c]), null);
  const plan = prepareVisibleNodeMove(original.segments, b, [a, c]);
  assert.throws(() => moves(plan, [181, 0]), /无效/);
  const stale = route(original.segments.map(line => line.slice()));
  assert.throws(() => applyTrackVisibleNodeMove(stale, plan, pt(1, 1)), /变化/);
  const moved = applyTrackVisibleNodeMove(original, plan, pt(1, 1));
  assert.equal(moved.segments[0].length, original.segments[0].length);
  assert.deepEqual(moved.segments[0][1], moved.segments[0][3]);
});

test('conflicting point details fail without mutating the original route record', () => {
  const a = pt(0), b = pt(1), c = pt(2);
  const original = route([[a, b, c]], { pointDetails: { [b.join(',')]: { color: '#ff0000', note: 'moving' }, [c.join(',')]: { color: '#0000ff', note: 'fixed' } } });
  const plan = prepareVisibleNodeMove(original.segments, b, [a, c]);
  assert.throws(() => applyTrackVisibleNodeMove(original, plan, c), /颜色冲突/);
  assert.deepEqual(original.pointDetails, { [b.join(',')]: { color: '#ff0000', note: 'moving' }, [c.join(',')]: { color: '#0000ff', note: 'fixed' } });
});
