import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedStats } from '../modules/tracks/recordedStats.ts';
import { recordedProfile, speedColor } from '../modules/tracks/recordedProfileData.ts';
import { startRouteEdit, styleRouteEdit, moveEditNode, prepareRouteEdit } from '../modules/tracks/routeEdit.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { mapDownloadPlan } from '../modules/outdoor/offline.ts';
import { DEFAULT_LAYERS } from '../modules/map/types.ts';
import { workbenchTree, workbenchTransfer } from '../modules/collections/workbenchAdapter.ts';
import { updateWorkbenchItem, workbenchLeaves } from '../modules/collections/workbenchTree.ts';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';
const t = {id:'walk',name:'上班',createdAt:1000000,source:'recorded',style:{color:'#ffb477',width:1.5},
  segments:[[[103,30],[103.0001,30],[103.0002,30]],[[103.01,30],[103.0101,30]]],
  samples:[[{time:1000000,altitude:10},{time:1010000,altitude:12},{time:1020000,altitude:11}], [{time:1200000,altitude:50},{time:1210000,altitude:52}]]};
test('reverse navigation changes only itinerary direction and preserves the recorded archive', () => {
  const original = {...t, segments:[[[103,30],[103.001,30],[103.002,30]]], samples:[t.samples[0]]};
  const snapshot=JSON.stringify(original);
  const forward=trackNavigation(original,1), backward=trackNavigation(original,1,'pedestrian',[],'main',true);
  assert.deepEqual(backward.route.coordinates,[...forward.route.coordinates].reverse());
  assert.deepEqual(backward.start.coordinates,forward.end.coordinates);
  assert.deepEqual(backward.end.coordinates,forward.start.coordinates);
  assert.deepEqual(backward.route.preferredTrackPath,backward.route.coordinates);
  assert.equal(backward.route.distance,forward.route.distance);
  assert.equal(JSON.stringify(original),snapshot);
});
test('measured duration and speeds exclude gaps; profile keeps segment boundaries', () => {
  const s=recordedStats(t); assert.equal(s.elapsed,210); assert.equal(s.seconds,30); assert.equal(s.gapSeconds,180);
  assert.equal(s.ascent,4); assert.equal(s.descent,1); assert.ok(s.averageSpeed>3&&s.averageSpeed<4);
  const p=recordedProfile(t); assert.equal(p[3].connected,false); assert.equal(p[3].speed,null); assert.equal(p[3].distance,p[2].distance);
  assert.equal(speedColor(null),'#8b9699'); assert.notEqual(speedColor(1),speedColor(40));
  const untimed=recordedStats({...t,samples:undefined}); assert.equal(untimed.elapsed,null); assert.equal(untimed.averageSpeed,null);
});
test('appearance saves on measured original; geometry saves a named copy with no measured data', () => {
  const styled=styleRouteEdit(startRouteEdit(t),{color:'#55d6ff',width:2,colorMode:'solid'});
  const result=prepareRouteEdit(styled,[t],'copy',2000000); const persisted=parseSavedTracks(JSON.stringify(result.records));
  assert.equal(persisted.length,1); assert.equal(persisted[0].id,t.id); assert.equal(persisted[0].source,'recorded');
  assert.deepEqual(persisted[0].samples,t.samples); assert.equal(persisted[0].style.color,'#55d6ff');
  const changed=moveEditNode(startRouteEdit(t),t.segments[0][1],[103.0001,30.001]);
  const copied=prepareRouteEdit(changed,[t],'copy',2000000); assert.equal(copied.records.length,2);
  assert.match(copied.track.name,/编辑副本/); assert.equal(copied.track.samples,undefined); assert.equal(copied.track.source,'manual');
  assert.deepEqual(copied.records.find(v=>v.id===t.id).samples,t.samples);
});
test('high detail TianDiTu offline route plans are paused before creating resources', () => {
  const area={kind:'route',segments:[[[103,30],[103.2,30]]],bufferKm:10};
  assert.throws(() => mapDownloadPlan(area,{...DEFAULT_LAYERS,satellite:true,tiandituBase:'img',labels:true},'tianditu',18), /天地图离线下载已暂停/);
});
test('collection visibility roundtrips without altering measured geometry or samples', () => {
  const data={format:'guanyun-backup',version:1,tracks:[t],favorites:[],annotations:[]};
  let tree=workbenchTree(data); assert.equal(workbenchLeaves(tree)[0].visible,true);
  tree=updateWorkbenchItem(tree,'track:walk',{visible:false}); const next=workbenchTransfer(data,tree);
  assert.equal(next.tracks[0].hidden,true); assert.deepEqual(next.tracks[0].samples,t.samples); assert.deepEqual(next.tracks[0].segments,t.segments);
  assert.equal(workbenchLeaves(workbenchTree(next))[0].visible,false);
});
