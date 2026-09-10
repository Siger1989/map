import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTrackNodes, insertTrackNode, removeTrackNode } from '../modules/tracks/nodeOperations.ts';
import { moveTrackNode } from '../modules/tracks/editing.ts';
import { inheritEdgeColors, preserveTrackColors, edgeColorIndex, coloredLineParts } from '../modules/tracks/edgeColors.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { joinSegments } from '../modules/tracks/snapping.ts';
import { replaceDraftGeometry, undoDraft, appendStroke, EMPTY_DRAFT } from '../modules/tracks/draft.ts';
import { drawingRecord } from '../modules/tracks/archive.ts';
import { startRouteEdit, styleRouteEdit } from '../modules/tracks/routeEdit.ts';
const track=(id,color,points)=>({id,name:id,source:'manual',createdAt:1,segments:[points],style:{color,width:2,opacity:1}});
const a=[104,30],b=[104.001,30],c=[104.002,30],d=[104.003,30],e=[104.004,30];
const red=track('red','#ff0000',[a,b,c]),blue=track('blue','#0000ff',[d,e]);
test('connecting keeps red and blue physical edges through storage and reversal',()=>{
  const joined=connectTrackNodes(red,c,blue,d,'joined');assert.deepEqual(joined.edgeColors,[['#ff0000','#ff0000'],['#0000ff'],['#ff0000']]);
  const read=parseSavedTracks(JSON.stringify([joined]))[0];assert.deepEqual(read.edgeColors,joined.edgeColors);
  const reversed=joinSegments(read.segments).reverse().map(line=>line.slice().reverse());const colors=inheritEdgeColors(reversed,[read]);assert.deepEqual(colors,[['#0000ff','#ff0000','#ff0000','#ff0000']]);
  const parts=coloredLineParts(reversed[0],edgeColorIndex({segments:reversed,edgeColors:colors}),'#ffffff');assert.deepEqual(parts.map(p=>p.color),['#0000ff','#ff0000']);assert.deepEqual(red.style.color,'#ff0000');
});
test('insertion, movement, deletion and re-connection preserve source colour boundaries',()=>{
  const joined=connectTrackNodes(red,c,blue,d,'joined'),middle=[104.0035,30];
  const inserted=insertTrackNode(joined,middle);assert.deepEqual(inserted.edgeColors[1],['#0000ff','#0000ff']);
  const moved=moveTrackNode(inserted,middle,[104.0035,30.001]);assert.deepEqual(moved.edgeColors,inserted.edgeColors);
  const cut=removeTrackNode(moved,b);assert.equal(cut.segments.some(line=>line.some(p=>p[0]===a[0])&&line.some(p=>p[0]===c[0])),false);
  assert.ok(cut.edgeColors.flat().includes('#0000ff'));
  const green=track('green','#00ff00',[e,[104.005,30]]),again=preserveTrackColors({...joined,segments:joinSegments([...joined.segments,...green.segments])},[joined,green]);
  assert.ok(again.edgeColors.flat().includes('#0000ff'));assert.ok(again.edgeColors.flat().includes('#00ff00'));
});
test('draft connection, append, undo and archive retain colours; explicit recolour resets them',()=>{
  const joined=connectTrackNodes(red,c,blue,d,'joined');
  const draft=replaceDraftGeometry(EMPTY_DRAFT,joined.segments,[],[],null,joined.edgeColors),extended=appendStroke(draft,[e,[104.006,30]]);
  assert.deepEqual(undoDraft(extended).edgeColors,draft.edgeColors);assert.equal(undoDraft(draft).edgeColors,undefined);
  const saved=drawingRecord({segments:extended.segments,edgeColors:extended.edgeColors,nodes:[],style:red.style,id:'draftsaved',name:'多色路线',createdAt:1,now:2});assert.deepEqual(parseSavedTracks(JSON.stringify([saved]))[0].edgeColors,extended.edgeColors);
  assert.deepEqual(styleRouteEdit(startRouteEdit(joined),{...red.style,width:3}).track.edgeColors,joined.edgeColors);
  assert.equal(styleRouteEdit(startRouteEdit(joined),{...red.style,color:'#00ff00'}).track.edgeColors,undefined);
});
