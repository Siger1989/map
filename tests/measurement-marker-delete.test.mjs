import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { measurementMetrics, parseMeasurement, pointPose, segmentMetrics } from '../modules/measurement/data.ts';
import { markerPhoto, photosForMarker, photoLocationLabel } from '../modules/photos/association.ts';
import { validPhoto } from '../modules/photos/storage.ts';
import { markerScale } from '../modules/annotations/markerScale.ts';
import { cutNodes } from '../modules/tracks/deleteNodes.ts';
import { removeEditNodes, selectEditNode, removeEditNode, startRouteEdit, storeRouteEdit, undoRouteEdit } from '../modules/tracks/routeEdit.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
const point = (id, coordinates, altitude = 100) => ({ id, coordinates, altitude, heightSource: altitude === null ? 'unknown' : 'manual' });
test('measurement distances, true-north bearings, dateline and unknown heights', () => {
  const a = point('a', [0, 0]), b = point('b', [0.001, 0], 200), c = point('c', [0.001, 0.001]);
  const ab = segmentMetrics(a, b);
  assert.ok(Math.abs(ab.horizontal - 111.195) < .01); assert.equal(ab.bearing, 90);
  assert.ok(Math.abs(ab.spatial - Math.hypot(ab.horizontal, 100)) < .001);
  assert.equal(segmentMetrics(b, c).bearing, 0);
  const m = measurementMetrics([a, b, c]); assert.ok(m.horizontal > 222 && m.horizontal < 223); assert.ok(m.spatial > m.horizontal);
  assert.equal(measurementMetrics([a, { ...b, altitude: null }]).spatial, null);
  assert.equal(segmentMetrics(a, a).bearing, null);
  assert.ok(segmentMetrics(point('d', [179.999, 0]), point('e', [-179.999, 0])).horizontal < 223);
  assert.equal(pointPose({ ...a, altitude: null }), null);
});
test('measurement archive rejects duplicate ids, invalid coordinates and invented height sources', () => {
  const points = [point('a', [104, 30]), point('b', [104, 31], null)];
  assert.deepEqual(parseMeasurement(JSON.stringify({ version: 1, points })), points);
  for (const invalid of [[points[0], points[0]], [point('a', [999, 30])], [{ ...points[1], heightSource: 'terrain' }]])
    assert.throws(() => parseMeasurement(JSON.stringify({ version: 1, points: invalid })));
});
test('camera attachment keeps marker identity, coordinate snapshot and honest fallback time', () => {
  const preview = new Blob(['jpeg'], { type: 'image/jpeg' });
  const draft = { hash: 'hash', name: 'photo.jpg', preview, detail: preview, time: null };
  const marker = { id: 'marker-a', name: '营地', coordinates: [104, 30] };
  const photo = markerPhoto(draft, marker, 1000); marker.coordinates[0] = 105;
  assert.equal(validPhoto(photo), true); assert.equal(photo.annotationId, 'marker-a'); assert.deepEqual(photo.coordinates, [104, 30]);
  assert.equal(photo.trackId, ''); assert.equal(photo.timeSource, 'camera'); assert.equal(photo.time, 1000);
  assert.equal(markerPhoto({ ...draft, time: 800 }, marker, 1000).timeSource, 'exif');
  assert.equal(photosForMarker([photo, { ...photo, annotationId: 'other' }], 'marker-a').length, 1);
  assert.match(photoLocationLabel(photo), /标记点/);
  assert.equal(validPhoto({ ...photo, trackId: 'fake' }), false);
});
test('marker shrink is monotonic, bounded and returns to full size on zoom in', () => {
  assert.equal(markerScale(16), 1); assert.equal(markerScale(3), .35);
  for (let z = 4; z < 16; z++) assert.ok(markerScale(z) < markerScale(z + 1));
  assert.ok(markerScale(10) < .7);
});
test('delete removes only selected vertices and incident edges across junctions', () => {
  const a = [104, 30], b = [104.01, 30], c = [104.02, 30], d = [104.03, 30], e = [104.04, 30];
  assert.deepEqual(cutNodes([[a, b, c, d, e], [b, e]], [b, d]), [[a], [c], [e], [e]]);
  assert.deepEqual(cutNodes([[a, b]], [a, b]), []);
});
test('batch removal is one undo, lone survivors reload, all-point removal saves without resurrecting other lines', () => {
  const points = [[104, 30], [104.01, 30], [104.02, 30], [104.03, 30]];
  const original = { id: 'route', name: 'route', source: 'manual', createdAt: 1, segments: [points] };
  const session = startRouteEdit(original), changed = removeEditNodes(session, [points[1], points[2]]);
  assert.deepEqual(changed.track.segments, [[points[0]], [points[3]]]);
  assert.equal(changed.history.length, 1); assert.deepEqual(undoRouteEdit(changed).track, session.track);
  let disk = JSON.stringify([original]); const storage = { getItem: () => disk, setItem: (_, v) => { disk = v; } };
  storeRouteEdit(changed, storage, 'unused', 2); assert.deepEqual(parseSavedTracks(disk)[0].segments, changed.track.segments);
  const remaining = startRouteEdit(parseSavedTracks(disk)[0]);
  const empty = removeEditNodes(remaining, remaining.track.segments.flat());
  assert.equal(storeRouteEdit(empty, storage, 'unused', 3).removed, true); assert.deepEqual(parseSavedTracks(disk), []);
});
test('measurement gizmo exposes XYZ translations without scaling or rotation; box selection picks only vertices', async () => {
  const built = await build({ stdin: { contents: `export {gizmoHandles} from './modules/objectTransform/gizmoHandles.ts'; export {objectProjector} from './modules/objectTransform/projection.ts'; export {nodesInBox} from './modules/tracks/TrackNodeBoxSelect.tsx'; export {markerPhotoArchiveEntries} from './modules/photos/markerArchive.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' } });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const { Vector3 } = await import('three');
  const p = { center: { x: 100, y: 100 }, radius: 30, axes: [new Vector3(1,0,0), new Vector3(0,1,0), new Vector3(0,0,1)], project: v => ({ x: 100+v.x+v.z, y: 100+v.y+v.z }) };
  assert.deepEqual(mod.gizmoHandles(p, 'measurement-point', true).targets.map(t => t.key), ['move-x','move-y','move-z','move-free']);
  assert.equal(mod.gizmoHandles(p, 'measurement-point', true).rings.length, 0);
  const points = [[1,1],[2,2],[5,5],[1,1]];
  assert.deepEqual(mod.nodesInBox(points, { left:0, top:0, right:3, bottom:3 }, p => ({ x:p[0], y:p[1] })), [[1,1],[2,2]]);
  const photo = { kind:'annotation', annotationId:'a', name:'p', preview:new Blob(['a']), detail:new Blob(['b']), time:1 };
  const entries = mod.markerPhotoArchiveEntries(['a'], [photo, { ...photo, annotationId:'other' }]);
  assert.equal(entries.length, 2); assert.equal(await entries[0].data.text(), 'b'); assert.equal(JSON.parse(entries[1].data).annotationId, 'a');
});
