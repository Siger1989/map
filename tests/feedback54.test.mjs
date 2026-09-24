import test from 'node:test';
import assert from 'node:assert/strict';
import {finishRecording} from '../modules/outdoor/finishRecording.ts';
const record=()=>({id:'r',phase:'recording',startedAt:1,error:'',segments:[[{coordinates:[103,30],time:1,accuracy:5,altitude:20}]]});
test('finish waits for final native snapshot and saves before clear',async()=>{
 let state=record(),calls=[],sent=false,ticks=0;
 const id=await finishRecording({keep:true,read:()=>state,send:a=>{calls.push(a);if(a==='finish')sent=true;else state={...state,phase:'idle'};},wait:async()=>{ticks++;if(sent)state={...state,phase:'finished',segments:[...state.segments,[{...state.segments[0][0],time:2}]]};},save:r=>{assert.equal(r.phase,'finished');assert.equal(r.segments.length,2);calls.push('saved');return 'r';}});
 assert.equal(id,'r');assert.equal(ticks,1);assert.deepEqual(calls,['finish','saved','clear']);
});
test('save failure and empty recording keep checkpoint; discard can end empty',async()=>{
 for(const empty of [false,true]){let state=record(),calls=[];if(empty)state.segments=[];
 const options={keep:true,read:()=>state,send:a=>{calls.push(a);state={...state,phase:a==='finish'?'finished':'idle'};},save:()=>{throw Error('disk full');}};
 await assert.rejects(finishRecording(options));assert.equal(state.phase,'finished');assert.deepEqual(calls,['finish']);
 await finishRecording({...options,keep:false});assert.equal(state.phase,'idle');}
});
test('native finish timeout never saves or clears',async()=>{
 const state=record(),calls=[];await assert.rejects(finishRecording({keep:true,read:()=>state,send:a=>calls.push(a),save:()=>{throw Error('must not save');},timeout:-1}));assert.deepEqual(calls,['finish']);
});
test('photo track remap completes before clearing and a remap failure keeps checkpoint for retry',async()=>{
 let state={...record(),phase:'finished'},calls=[];
 const save=async()=>{calls.push('save');return 'existing-id';};
 const remap=async(from,to)=>{assert.equal(from,'r');assert.equal(to,'existing-id');calls.push('remap');};
 const id=await finishRecording({keep:true,read:()=>state,send:a=>{calls.push(a);if(a==='clear')state={...state,phase:'idle'};},save:async r=>{const saved=await save(r);await remap(r.id,saved);return saved;}});
 assert.equal(id,'existing-id');assert.deepEqual(calls,['finish','save','remap','clear']);
 state={...record(),phase:'finished'};calls=[];
 await assert.rejects(finishRecording({keep:true,read:()=>state,send:a=>{calls.push(a);if(a==='clear')state={...state,phase:'idle'};},save:async r=>{const saved=await save(r);throw Error(`remap failed for ${r.id} -> ${saved}`);}}));
 assert.equal(state.phase,'finished');assert.deepEqual(calls,['finish','save']);
});
