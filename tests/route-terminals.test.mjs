import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { resolvedRouteTerminals } from '../modules/tracks/routeTerminals.ts';
import { startRouteEdit, setEditEnd, toggleEditBranch, appendEditBranch, moveEditNode, removeEditNodes, undoRouteEdit, editedRouteRecord } from '../modules/tracks/routeEdit.ts';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';

const a=[104,30],b=[104.001,30],c=[104.002,30],d=[104.001,30.001],e=[104.001,30.002];
const base={id:'terminals',name:'终点选择验证',source:'manual',createdAt:1,segments:[[a,b,c]],style:{color:'#33aa77',width:2}};

test('adding a branch does not steal the end of the route; choosing another end is undoable and persists',()=>{
  let session=startRouteEdit(base);
  assert.deepEqual(resolvedRouteTerminals(session.track),[a,c]);
  session={...session,selected:b};
  session=toggleEditBranch(session);
  session=appendEditBranch(session,d);
  session=toggleEditBranch(session);
  assert.deepEqual(resolvedRouteTerminals(session.track),[a,c]);
  assert.deepEqual(session.track.routeTerminals.end,c);
  const chosen=setEditEnd(session,d);
  assert.deepEqual(resolvedRouteTerminals(chosen.track),[a,d]);
  assert.deepEqual(resolvedRouteTerminals(undoRouteEdit(chosen).track),[a,c]);
  const stored=editedRouteRecord(chosen,'unused',2);
  assert.deepEqual(parseSavedTracks(JSON.stringify([stored]))[0].routeTerminals,{start:a,end:d});
  assert.deepEqual(resolvedRouteTerminals(stored),[a,d]);
});

test('moving or deleting the chosen endpoint updates or clears it without inventing the branch tip',()=>{
  const branch={...base,segments:[[a,b,c],[b,d]],routeTerminals:{start:a,end:c}};
  const moved=moveEditNode(startRouteEdit(branch),c,e);
  assert.deepEqual(resolvedRouteTerminals(moved.track),[a,e]);
  const cut=removeEditNodes(moved,[e]);
  assert.deepEqual(resolvedRouteTerminals(cut.track),[a,null]);
  assert.deepEqual(resolvedRouteTerminals(undoRouteEdit(cut).track),[a,e]);
});

test('old branched tracks do not claim their last array endpoint; ordinary old tracks keep prior ends',()=>{
  assert.deepEqual(resolvedRouteTerminals(base),[a,c]);
  const split={...base,segments:[[a,b],[c,d]]};
  assert.deepEqual(resolvedRouteTerminals(split),[a,d]);
  const oldBranch={...base,segments:[[a,b,c],[b,d]]};
  assert.deepEqual(resolvedRouteTerminals(oldBranch),[a,null]);
  assert.equal(parseSavedTracks(JSON.stringify([{...oldBranch,routeTerminals:{end:[0,0]}}]))[0].routeTerminals,undefined);
});

test('navigation follows the chosen fork endpoint and refuses an unconfirmed fork',()=>{
  const fork={...base,segments:[[a,b,c],[b,d]]};
  assert.throws(()=>trackNavigation(fork),/终点未指定/);
  assert.throws(()=>trackNavigation({...fork,routeTerminals:{start:a}}),/终点未指定/);
  const selected={...fork,routeTerminals:{start:a,end:d}};
  const forward=trackNavigation(selected);
  assert.deepEqual(forward.route.coordinates,[a,b,d]);
  assert.deepEqual(forward.end.coordinates,d);
  const reversed=trackNavigation(selected,3,'pedestrian',[],'main',true);
  assert.deepEqual(reversed.route.coordinates,[d,b,a]);
  assert.deepEqual(reversed.end.coordinates,a);
});
