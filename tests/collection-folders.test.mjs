import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, validateLayout, parseLayout, deleteGroup, groupFor, moveEntry, COLLECTION_STORAGE } from '../modules/collections/data.ts';
import { folderContents, folderEntries, folderPath, collectionSubset } from '../modules/collections/folders.ts';
import { mergeCollections } from '../modules/collections/transfer.ts';
import { folderTheme } from '../modules/collections/folderTheme.ts';
import { catalogEntries } from '../modules/collections/catalog.ts';
import { collectionTransfer } from '../modules/collections/export.ts';

const nested = () => ({version: 1, groups: [
  {id:'trip',name:'旅行',color:'#132c23'},
  {id:'day',name:'第一天',color:'#c5e6d5',parentId:'trip'},
  {id:'camp',name:'营地',color:'#a0486c',parentId:'day'},
], assignments:{'annotation:pin':'day'}, order:[]});
const pin = {id:'pin',kind:'pin',name:'营地标记',note:'',color:'#447766',coordinates:[104,30],groundElevation:null,placement:'surface',offset:0,width:1,length:1,height:1,heading:0,pitch:0,roll:0,opacity:0.5,visible:true};

test('legacy folders remain roots; malformed parents, cycles and excess depth are rejected', () => {
  assert.deepEqual(parseLayout(JSON.stringify(defaultLayout())),defaultLayout());
  assert.equal(validateLayout(nested()).groups.length,3);
  for (const parentId of ['missing','day',null,44]) {
    const layout=nested(); layout.groups[1].parentId=parentId;
    assert.throws(()=>validateLayout(layout));
  }
  const cycle=nested();cycle.groups[0].parentId='camp';assert.throws(()=>validateLayout(cycle));
  const deep=nested();deep.groups=Array.from({length:8},(_,i)=>({id:`d${i}`,name:`第${i}层`,color:'#123456',...(i?{parentId:`d${i-1}`}:{})}));
  assert.doesNotThrow(()=>validateLayout(deep));
  deep.groups.push({id:'d8',name:'第9层',color:'#123456',parentId:'d7'});assert.throws(()=>validateLayout(deep));
});
test('nested folder listing and moves cover pins, models, areas and sections without changing map data',()=>{
  const entries=folderEntries(catalogEntries([],[],[pin,{...pin,id:'model',kind:'box'}],[]));
  const source=structuredClone(entries);let layout=nested();
  assert.equal(folderPath(layout,'camp'),'旅行 / 第一天 / 营地');
  assert.deepEqual(folderContents(layout,entries,'trip').map(e=>e.key),['annotation:pin']);
  layout=moveEntry(layout,entries,'annotation:model','camp');
  assert.equal(folderContents(layout,entries,'trip').length,2);
  layout.assignments['area:a']='camp';layout.assignments['section:s']='trip';
  assert.doesNotThrow(()=>validateLayout(layout));assert.deepEqual(entries,source);
});
test('deleting a parent preserves objects and promotes its child folders without orphaning ancestry',()=>{
  const layout=deleteGroup(nested(),'day');validateLayout(layout);
  assert.equal(layout.groups.find(g=>g.id==='camp').parentId,'trip');
  assert.equal(layout.assignments['annotation:pin'],'unfiled');
  const rootRemoved=deleteGroup(layout,'trip');
  assert.equal(rootRemoved.groups[0].parentId,undefined);
  assert.doesNotThrow(()=>parseLayout(JSON.stringify(rootRemoved)));
});
test('backup merges remap colliding parents before children and preserve both sets of colors',()=>{
  const local=nested();local.groups[0].color='#ffffff';
  // Children arrive before parents, as in a reordered folder list.
  const incoming=nested();incoming.groups.reverse();
  const keys=new Map([['annotation:pin','annotation:imported']]);
  const merged=mergeCollections(local,incoming,keys,new Map());
  assert.equal(merged.groups.find(g=>g.id==='trip').color,'#ffffff');
  const importedDay=merged.groups.find(g=>g.id===merged.assignments['annotation:imported']);
  assert.notEqual(importedDay.id,'day');assert.notEqual(importedDay.parentId,'trip');
  assert.equal(merged.groups.find(g=>g.id===importedDay.parentId).color,'#132c23');
  const again=mergeCollections(merged,incoming,keys,new Map());
  assert.equal(again.groups.length,merged.groups.length);
  assert.deepEqual(local,nestedWithWhite());
  function nestedWithWhite(){const v=nested();v.groups[0].color='#ffffff';return v;}
});
test('selected export includes ancestor colors, excludes unrelated folders, and restores marker membership',()=>{
  const layout=nested(), entries=folderEntries(catalogEntries([],[],[pin],[]));
  const subset=collectionSubset(layout,entries);
  assert.deepEqual(subset.groups.map(g=>g.id),['trip','day']);
  const transfer=collectionTransfer(entries,{}, {getItem:key=>key===COLLECTION_STORAGE?JSON.stringify(layout):null});
  assert.deepEqual(transfer.collections,subset);
  const restored=mergeCollections(undefined,JSON.parse(JSON.stringify(subset)),new Map([['annotation:pin','annotation:pin']]),new Map());
  assert.equal(groupFor(restored,entries[0]).color,'#c5e6d5');
  assert.equal(folderPath(restored,'day'),'旅行 / 第一天');
});
test('custom panel colors choose readable text across light, dark and midtone colors',()=>{
  for(const color of ['#000000','#ffffff','#132c23','#c5e6d5','#777777','#ff00ff','#008800']){
    const theme=folderTheme(color);assert.equal(theme['--folder-background'],color);
    const linear=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    const l=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
    const contrast=theme['--folder-text']==='#ffffff'?1.05/(l+.05):(l+.05)/.05;
    assert.ok(contrast>=4.5,`${color} contrast ${contrast}`);
  }
  assert.equal(folderTheme('url(attack)'),undefined);assert.equal(folderTheme(null),undefined);
});
