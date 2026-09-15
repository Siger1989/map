import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFromTrip,saveTripRoute,tripStats,isTrip} from '../modules/outdoor/tripData.ts';
import {photoTimeRange,classifyPhoto} from '../modules/photos/metadata.ts';
import {awaitRecordingCommand} from '../modules/outdoor/recordingCommand.ts';
import {emptyRecording} from '../modules/outdoor/recording.ts';
import {TRACK_STORAGE,parseSavedTracks} from '../modules/tracks/drawing.ts';
import {keepsOriginalPoints} from '../modules/tracks/provenance.ts';
import {newAnnotation} from '../modules/annotations/data.ts';
import {commitAnnotationEdit,annotationEditItems} from '../modules/annotations/editorSession.ts';
import {collectData} from '../modules/outdoor/exchange.ts';
import {saveWorkbench} from '../modules/collections/workbenchStore.ts';
import {hiddenKeys,visibilityTransfer,hiddenProjection,HIDDEN_FOLDER} from '../modules/collections/hidden.ts';
import {workbenchTree} from '../modules/collections/workbenchAdapter.ts';
import {editSectionRange} from '../modules/tracks/sections.ts';
import {readDrawingCheckpoint,writeDrawingCheckpoint,DRAWING_CHECKPOINT} from '../modules/tracks/drawingCheckpoint.ts';
const start=Date.UTC(2026,8,15,0),a=[104,30],b=[104.0001,30],c=[104.0002,30];
const trip={id:'trip',name:'测试行程',source:'recorded',createdAt:start,finishedAt:start+150000,segments:[[a,b,c]],samples:[[{time:start,altitude:600},{time:start+60000,altitude:650},{time:start+120000,altitude:700}]],style:{color:'#008c38',colorMode:'speed',width:2,opacity:1},sections:{edges:[['a','b']],notes:{a:'碎石',b:'林道'}}};
const memory=()=>{const map=new Map([[TRACK_STORAGE,JSON.stringify([trip])]]);return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
test('trip conversion produces independent editable geometry and altitude without historical speed or photos',()=>{
 const before=structuredClone(trip),route=routeFromTrip(trip,'新路线','route',start+300000);
 assert.equal(isTrip(route),false);assert.equal(keepsOriginalPoints(route),false);assert.equal(route.sourceTripId,trip.id);assert.equal(route.sourceTrackIds,undefined);
 assert.deepEqual(route.samples[0].map(s=>s.time),[null,null,null]);assert.equal(route.samples[0][2].altitude,700);assert.equal(route.style.colorMode,'solid');
 route.segments[0][0][0]=0;route.sections.notes.a='改变';assert.deepEqual(trip,before);
});
test('conversion verifies save before offering hide; original remains visible and unchanged',()=>{
 const disk=memory(),saved=saveTripRoute(trip,'转换',disk);assert.equal(saved.sourceTripId,'trip');assert.equal(collectData(disk).tracks.length,2);assert.deepEqual(collectData(disk).tracks[0],trip);
 assert.throws(()=>saveTripRoute({...trip,name:'过期快照'},'转换',disk),/已变化/);
 const full=memory();assert.throws(()=>saveTripRoute(trip,'转换',{...full,setItem(){throw Error('quota')}}),/未保存/);assert.deepEqual(collectData(full).tracks,[trip]);
});
test('silent storage writes fail instead of hiding an unsaved source',()=>{
 const disk=memory(),before=collectData(disk);assert.throws(()=>saveWorkbench(before,visibilityTransfer(before,['track:trip'],false),{...disk,setItem(){}}),/未保存/);assert.equal(collectData(disk).tracks[0].hidden,undefined);
});
test('hidden projection restores original folder membership and has no duplicate visible leaf',()=>{
 const disk=memory(),data=collectData(disk);data.collections={version:1,groups:[{id:'week',name:'周末',color:'#224433'}],assignments:{'track:trip':'week'},order:[]};
 const hidden=visibilityTransfer(data,['track:trip'],false),tree=hiddenProjection(workbenchTree(hidden),hiddenKeys(hidden));
 assert.deepEqual(tree.find(i=>i.id===HIDDEN_FOLDER).children.map(i=>i.id),['track:trip']);
 assert.equal(tree.find(i=>i.id==='week').children.length,0);assert.equal(hidden.collections,data.collections);
 const restored=visibilityTransfer(hidden,['track:trip'],true);assert.equal(hiddenKeys(restored).size,0);assert.equal(restored.collections.assignments['track:trip'],'week');assert.equal(restored.tracks[0].samples,trip.samples===data.tracks[0].samples?trip.samples:data.tracks[0].samples);
});
test('hidden state belongs to each object, batch restore leaves others untouched',()=>{
 const data={...collectData(memory()),annotations:[{...newAnnotation('pin',a,0,'p'),visible:false}],areas:[],sections:[]};
 assert.deepEqual([...hiddenKeys(data)],['annotation:p']);const next=visibilityTransfer(data,['annotation:p','track:trip'],true);assert.equal(next.annotations[0].visible,true);assert.equal(data.annotations[0].visible,false);
});
test('photo candidates filter time before GPS and require consent for missing or conflicting metadata',()=>{
 assert.deepEqual(photoTimeRange(trip),{start,end:start+120000});
 assert.equal(classifyPhoto(trip,{time:start-1,gps:a},100).status,'skip');
 assert.match(classifyPhoto(trip,{time:null,gps:a},100).reason,/缺少/);
 assert.equal(classifyPhoto(trip,{time:start+60000},100).status,'pending');
 assert.equal(classifyPhoto(trip,{time:start+60000,gps:[0,0]},100).status,'pending');
 assert.equal(classifyPhoto(trip,{time:start+60000,gps:b},100).status,'matched');
});
test('paused intervals are not interpolated into fictional photo positions',()=>{
 const gaps={...trip,segments:[[a,b],[c,[104.0003,30]]],samples:[[trip.samples[0][0],trip.samples[0][1]],[{time:start+240000,altitude:700},{time:start+300000,altitude:710}]]};
 assert.match(classifyPhoto(gaps,{time:start+180000,gps:c},100).reason,/断点/);assert.equal(tripStats(gaps).sampledSeconds,120);
});
test('trip stats show full duration separately from valid sampled intervals',()=>{const s=tripStats(trip);assert.equal(s.duration,150);assert.equal(s.sampledSeconds,120);assert.ok(s.average>0);assert.equal(s.start,start);});
const recording={...emptyRecording(),id:'session',phase:'recording',startedAt:start,segments:[[{coordinates:a,time:start,altitude:600,accuracy:5}]]};
test('atomic native finish returns its final GPS sample, not the pre-command snapshot',async()=>{
 const last={...recording,phase:'finished',segments:[[...recording.segments[0],{coordinates:b,time:start+60000,altitude:610,accuracy:5}]]};
 const result=await awaitRecordingCommand('finish','session',{recordState:()=>JSON.stringify(recording),record(){throw Error('wrong path')},recordFor:(action,id)=>{assert.equal(action,'finish');assert.equal(id,'session');return JSON.stringify({ok:true,record:JSON.stringify(last)})}});
 assert.equal(result.segments[0].length,2);
});
test('late native acknowledgements cannot save a different recording',async()=>{
 const bridge={recordState:()=>JSON.stringify(recording),record(){},recordFor:()=>JSON.stringify({ok:true,record:JSON.stringify({...recording,id:'new',phase:'finished'})})};
 await assert.rejects(awaitRecordingCommand('finish','session',bridge),/未确认/);await assert.rejects(awaitRecordingCommand('finish','old',bridge),/已切换/);
 await assert.rejects(awaitRecordingCommand('clear','session',{...bridge,recordFor:()=>JSON.stringify({ok:false,error:'磁盘失败'})}),/磁盘失败/);
});
test('old bridge waits for its ID and phase, and timeout keeps the record',async()=>{
 let n=0;const bridge={record(){},recordState:()=>JSON.stringify(n>=2?{...recording,phase:'finished'}:recording)};
 assert.equal((await awaitRecordingCommand('finish','session',bridge,{wait:async()=>{n++},attempts:3})).phase,'finished');n=0;
 await assert.rejects(awaitRecordingCommand('clear','session',bridge,{wait:async()=>{},attempts:2}),/未收到/);
});
test('new marker stays a temporary preview until successful commit; cancel leaves no record',()=>{
 const original=[],base=newAnnotation('box',a,600,'new'),edit={creating:true,base,draft:{...base,name:'新模型'}};
 assert.equal(annotationEditItems(original,edit).length,1);assert.equal(original.length,0);assert.deepEqual(annotationEditItems(original,null),[]);
 assert.equal(commitAnnotationEdit(original,edit)[0].name,'新模型');assert.throws(()=>commitAnnotationEdit([base],edit),/重复覆盖/);
 assert.throws(()=>commitAnnotationEdit(Array.from({length:80},(_,i)=>({...base,id:'m'+i})),edit),/已满/);
});
test('drill accepts unknown legacy diameter and preserves explicit diameter and depth',()=>{
 const base={...newAnnotation('pin',a,600,'drill'),borehole:{depth:null}};
 assert.equal(commitAnnotationEdit([],{creating:true,base,draft:base})[0].borehole.diameterMm,undefined);
 const draft={...base,borehole:{depth:12,diameterMm:100}};assert.deepEqual(commitAnnotationEdit([base],{base,draft})[0].borehole,draft.borehole);
 assert.throws(()=>commitAnnotationEdit([base],{base,draft:{...draft,borehole:{depth:-1}}}),/无效/);
});
test('editing a subrange changes only selected edges even within the same old section',()=>{
 const route={...trip,sections:{edges:[['same','same']],notes:{same:'原备注'}}},next=editSectionRange(route,{part:0,from:0,to:1},'#ff0000','新备注');
 assert.notEqual(next.sections.edges[0][0],'same');assert.equal(next.sections.edges[0][1],'same');assert.equal(next.sections.notes.same,'原备注');assert.equal(next.edgeColors[0][1],trip.style.color);
});
test('completed checkpoint never revives saved drawing; failed clear is reported',()=>{
 const disk=memory(),value={draft:{segments:trip.segments},style:trip.style,name:'草稿',editingId:null,startedAt:start,sectionId:'x',note:'',completed:'saved'};
 writeDrawingCheckpoint(value,disk);assert.equal(readDrawingCheckpoint(disk.getItem(DRAWING_CHECKPOINT)),null);
 assert.throws(()=>writeDrawingCheckpoint({...value,draft:{segments:[]}},{...disk,removeItem(){}}),/未清除/);
 assert.throws(()=>readDrawingCheckpoint('{broken'),SyntaxError);
});
test('invalid optional source and finish metadata cannot corrupt a legacy track',()=>{
 const result=parseSavedTracks(JSON.stringify([{...trip,sourceTripId:{bad:true},finishedAt:'bad'}]))[0];assert.equal(result.sourceTripId,undefined);assert.equal(result.finishedAt,undefined);assert.equal(result.id,trip.id);
});
