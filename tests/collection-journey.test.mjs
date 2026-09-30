import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoJourney } from '../scripts/create-demo-journey.mjs';
import { COLLECTION_TABS, matchesCollectionTab, completeTabOrder } from '../modules/collections/tabOrder.ts';
import { workbenchTree, workbenchTransfer } from '../modules/collections/workbenchAdapter.ts';
import { workbenchLeaves } from '../modules/collections/workbenchTree.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { trackSourceLabel } from '../modules/tracks/provenance.ts';
import { recordedStats } from '../modules/tracks/recordedStats.ts';

test('journey classification keeps saved tab keys, planned routes, and original archives intact', () => {
  assert.equal(COLLECTION_TABS.route, '行程');
  assert.deepEqual(completeTabOrder(['track', 'route']).slice(0, 2), ['track', 'route']);
  const data = createDemoJourney(), original = JSON.stringify(data);
  data.tracks.push({ id: 'manual', name: '手绘', createdAt: 1, source: 'manual', segments: [[[85,28],[85.001,28]]] });
  data.tracks.push({ id: 'timed', name: '旧导入', createdAt: 1, segments: [[[85,28],[85.001,28]]], samples: [[{time:1,altitude:null},{time:10001,altitude:null}]] });
  data.tracks.push({ id: 'untimed', name: '无时间导入', createdAt: 1, source: 'gpx', segments: [[[85,28],[85.001,28]]], samples: [[{time:null,altitude:1},{time:null,altitude:2}]] });
  const snapshot = JSON.stringify(data);
  const tree = workbenchTree(data), leaves = workbenchLeaves(tree);
  assert.deepEqual(leaves.filter(i => matchesCollectionTab(i,'route')).map(i=>i.id).sort(), ['track:shantu-demo-running-20260930', 'track:timed']);
  assert.deepEqual(leaves.filter(i => matchesCollectionTab(i,'track')).map(i=>i.id).sort(), ['track:manual','track:untimed']);
  assert.equal(matchesCollectionTab({kind:'route'}, 'route'), true);
  assert.equal(matchesCollectionTab({kind:'track',journey:true,visible:false}, 'hidden'), true);
  const next = workbenchTransfer(data, tree);
  assert.deepEqual(next.tracks, data.tracks);
  assert.deepEqual(next.annotations, data.annotations);
  assert.equal(JSON.stringify(data), snapshot);
  assert.equal(JSON.stringify(createDemoJourney()), original);
});

test('running sample survives validation with timestamps, elevations, pause, markers, and explicit simulation provenance', () => {
  const data = createDemoJourney(), track = parseSavedTracks(JSON.stringify(data.tracks))[0];
  assert.equal(track.simulation, true);
  assert.equal(trackSourceLabel(track), '模拟行程');
  assert.equal(track.style.travelMode, 'run');
  const stats = recordedStats(track);
  assert.equal(stats.points, 181); assert.equal(stats.elapsed, 1800);
  assert.ok(stats.distance > 4000 && stats.distance < 4400);
  assert.equal(stats.seconds - stats.movingSeconds, 120);
  assert.ok(stats.ascent > 0 && stats.descent > 0);
  assert.equal(data.annotations.length, 4);
  assert.ok(data.annotations.every(a => a.trackAnchor.trackId === track.id && a.name.includes('模拟')));
  assert.deepEqual(track.samples, data.tracks[0].samples);
  assert.deepEqual(track.pointDetails, data.tracks[0].pointDetails);
});
