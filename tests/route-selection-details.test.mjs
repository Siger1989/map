import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSelectionDetails, selectedEdges, explicitNodeColors } from '../modules/tracks/selectionDetails.ts';
import { routeEndpoints } from '../modules/tracks/routeEndpoints.ts';
import { startRouteEdit, moveEditNode, removeEditNodes, undoRouteEdit, editSelectionDetails, editedRouteRecord, addEditMarker } from '../modules/tracks/routeEdit.ts';
import { storeJoinedRouteEdit } from '../modules/tracks/joinedEditStore.ts';
import { TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import { ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
import { normalizeTrackStyle } from '../modules/tracks/style.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { insertTrackNode } from '../modules/tracks/nodeOperations.ts';
import { routeColorSections } from '../modules/tracks/colorSections.ts';
import { displayedNodeColors, displayedPointColor, moveSelectedPoints } from '../modules/tracks/displayColors.ts';
const a=[104,30], b=[104.001,30], c=[104.002,30], d=[104.003,30], e=[104.004,30];
const track={id:'selection',name:'分段验证',source:'manual',createdAt:1,segments:[[a,b,c,d,e]],style:{color:'#ff0000',width:2}};

test('moving a selected point retains its selection and inspector color matches the map after reselecting', () => {
  const colored=changeSelectionDetails(changeSelectionDetails(track,[b,c],{color:'#2266dd'}),[b],{color:'#e23b35',note:'路口'});
  const target=[104.001,30.0001], moved=moveEditNode(startRouteEdit(colored),b,target).track;
  assert.deepEqual(moveSelectedPoints([b,c],b,target),[target,c]);
  assert.equal(displayedPointColor(moved,target),'#e23b35');
  assert.equal(displayedPointColor(moved,target),displayedNodeColors(moved).get(target.join(',')));
  assert.equal(displayedPointColor(moved,c),'#2266dd');
  assert.deepEqual(moveSelectedPoints([b,c],b,c),[c]);
  assert.deepEqual(moveSelectedPoints([a],b,target),[target]);
});

test('single point details leave edge colors and other points unchanged; metadata survives save/parse/undo', () => {
  const session=editSelectionDetails(startRouteEdit(track),[b],{color:'#00ff00',note:'水源'});
  assert.deepEqual(session.track.pointDetails, {[b.join(',')]:{color:'#00ff00',note:'水源'}});
  assert.equal(session.track.edgeColors,undefined);
  const saved=editedRouteRecord(session,'unused',2);
  assert.deepEqual(parseSavedTracks(JSON.stringify([saved]))[0].pointDetails,saved.pointDetails);
  assert.deepEqual(undoRouteEdit(session).track.pointDetails,undefined);
});
test('multi-point edits affect only edges with both endpoints selected, not same-color outsiders or gaps', () => {
  const next=changeSelectionDetails(track,[b,c,d],{color:'#0000ff',note:'碎石路'});
  assert.deepEqual(next.edgeColors,[[null,'#0000ff','#0000ff',null]]);
  assert.deepEqual(next.edgeNotes,[[null,'碎石路','碎石路',null]]);
  const other=changeSelectionDetails(next,[a,b],{note:'平路'});
  assert.deepEqual(other.edgeColors,next.edgeColors);
  assert.deepEqual(other.edgeNotes,[['平路','碎石路','碎石路',null]]);
  assert.equal(selectedEdges([[a,b],[c,d]],[b,c]).length,0);
  assert.throws(()=>changeSelectionDetails(track,[a,c],{note:'跨段'}),/没有相连/);
  assert.equal(track.edgeColors,undefined);
});
test('point moves, edge insertions and cuts keep only the correct point/edge notes', () => {
  let next=changeSelectionDetails(track,[b,c],{note:'窄路'});
  next=changeSelectionDetails(next,[b],{note:'路口'});
  const moved=moveEditNode(startRouteEdit(next),b,[104.001,30.0001]).track;
  assert.equal(moved.pointDetails[b.join(',')],undefined);
  assert.equal(moved.pointDetails['104.001,30.0001'].note,'路口');
  assert.equal(moved.edgeNotes[0][1],'窄路');
  const inserted=insertTrackNode(next,[104.0015,30]);
  assert.deepEqual(inserted.edgeNotes,[[null,'窄路','窄路',null,null]]);
  const cut=removeEditNodes(startRouteEdit(next),[c]).track;
  assert.equal(cut.edgeNotes,undefined);
  assert.equal(cut.pointDetails[b.join(',')].note,'路口');
});
test('cut halves rejoin within one route and the join is not an endpoint; undo restores the cut', () => {
  const cut=removeEditNodes(startRouteEdit(track),[c]);
  const joined=moveEditNode(cut,d,b);
  assert.deepEqual(joined.track.segments,[[a,b,e]]);
  assert.deepEqual(routeEndpoints(joined.track.segments),[a,e]);
  assert.deepEqual(undoRouteEdit(joined).track.segments,[[a,b],[d,e]]);
  assert.deepEqual(routeEndpoints([[a,b],[e,b]]),[a,e]);
  const branch=routeEndpoints([[a,b],[b,c],[d,b]]);
  assert.equal(branch.some(p=>p?.join(',')===b.join(',')),false);
  assert.deepEqual(routeEndpoints([[a,b,c,a]]),[null,null]);
});
test('edge notes remain distinct even when two adjacent sections have the same color', () => {
  const next=changeSelectionDetails(track,[b,c],{note:'独立备注'});
  const sections=routeColorSections(next);
  assert.deepEqual(sections.map(s=>s.condition),['','独立备注','']);
  const legacy=parseSavedTracks(JSON.stringify([{...track,pointDetails:{bad:{note:3}},edgeNotes:['bad']}]))[0];
  assert.equal(legacy.id,track.id);
  assert.equal(legacy.pointDetails,undefined);
  assert.equal(legacy.edgeNotes,undefined);
});
test('explicit edge colors win for nodes, point overrides win last, and point size clamps independently of line width', () => {
  let next=changeSelectionDetails(track,[b,c,d],{color:'#00ff00'});
  assert.equal(explicitNodeColors(next).get(c.join(',')),'#00ff00');
  next=changeSelectionDetails(next,[c],{color:'#0000ff'});
  assert.equal(explicitNodeColors(next).get(c.join(',')),'#0000ff');
  assert.equal(explicitNodeColors(next).get(b.join(',')),'#00ff00');
  assert.equal(normalizeTrackStyle({width:1,pointSize:6}).pointSize,6);
  assert.equal(normalizeTrackStyle({width:1,pointSize:999}).pointSize,16);
  assert.equal(normalizeTrackStyle({width:2,pointSize:0}).pointSize,4);
});
test('point marker stays in edit draft, moves with the node, undoes and atomically saves with the final route identity', () => {
  const data=new Map([[TRACK_STORAGE,JSON.stringify([track])]]);
  const disk={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const first=startRouteEdit(track);
  const pending=addEditMarker(first,b,{name:'水源',note:'可补水',color:'#00ff00',icon:'water'},'marker-1',123);
  assert.equal(data.has(ANNOTATION_STORAGE),false);
  assert.equal(undoRouteEdit(pending).pendingMarkers,undefined);
  const moved=moveEditNode(pending,b,[104.001,30.0001]);
  assert.deepEqual(moved.pendingMarkers[0].coordinates,[104.001,30.0001]);
  assert.equal(removeEditNodes(moved,[[104.001,30.0001]]).pendingMarkers.length,0);
  storeJoinedRouteEdit(moved,disk,'copy',2);
  const marker=JSON.parse(data.get(ANNOTATION_STORAGE))[0];
  assert.equal(marker.name,'水源');
  assert.equal(marker.trackAnchor.trackId,track.id);
  assert.equal(marker.note,'可补水');
  assert.ok(marker.trackAnchor.distance>0);
});
