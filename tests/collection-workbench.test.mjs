import test from 'node:test';
import assert from 'node:assert/strict';
import { workbenchTree, workbenchTransfer } from '../modules/collections/workbenchAdapter.ts';
import { dissolveWorkbenchFolder, dropWorkbenchItems, flattenWorkbench, moveWorkbenchItems, removeWorkbenchItems, updateWorkbenchItem } from '../modules/collections/workbenchTree.ts';
import { saveWorkbench } from '../modules/collections/workbenchStore.ts';
import { collectData, validateTransfer } from '../modules/outdoor/exchange.ts';
import { newAnnotation, ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
import { TRACK_STORAGE } from '../modules/tracks/drawing.ts';
import { FAVORITES_STORAGE } from '../modules/navigation/favorites.ts';
import { COLLECTION_STORAGE } from '../modules/collections/data.ts';
import { collectionTransfer } from '../modules/collections/export.ts';
import { catalogEntries } from '../modules/collections/catalog.ts';
import { workbenchImageRoutes, selectedWorkbenchKeys } from '../modules/collections/workbenchShareData.ts';

const data = () => validateTransfer({ format:'guanyun-backup',version:1, favorites:[],
  tracks:[{id:'walk',name:'真实实走轨迹',source:'recorded',createdAt:1000,segments:[[[104,30],[104.001,30.001]]]}],
  annotations:[{...newAnnotation('pin',[104,30],100,'pin'),name:'营地',note:'保留备注',attributes:[{id:'field',name:'水源',value:'有'}]}],
  collections:{version:1,groups:[{id:'trip',name:'周末',color:'#224433'},{id:'day',name:'第一天',color:'#ffeeaa',parentId:'trip'}],assignments:{'track:walk':'day','annotation:pin':'trip'},order:['annotation:pin','track:walk']},
});
const find = (tree,id) => flattenWorkbench(tree).find(i=>i.id===id);
function storeOf(input) {
  const map=new Map([[TRACK_STORAGE,JSON.stringify(input.tracks)],[ANNOTATION_STORAGE,JSON.stringify(input.annotations)],[FAVORITES_STORAGE,JSON.stringify(input.favorites)],[COLLECTION_STORAGE,JSON.stringify(input.collections)]]);
  return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
}
test('tree projection and mixed reorder preserve original records and survive reload',()=>{
  const before=data(), tree=workbenchTree(before);
  const moved=dropWorkbenchItems(tree,new Set(['annotation:pin']),'day','before');
  const next=workbenchTransfer(before,moved);
  assert.deepEqual(next.tracks,before.tracks);assert.deepEqual(next.annotations,before.annotations);
  assert.deepEqual(find(workbenchTree(next),'trip').children.map(i=>i.id),['annotation:pin','day']);
  const grouped=workbenchTransfer(next,moveWorkbenchItems(workbenchTree(next),new Set(['annotation:pin']),'day'));
  assert.equal(grouped.collections.assignments['annotation:pin'],'day');
  assert.deepEqual(grouped.annotations,before.annotations);
});
test('rename and color do not rewrite track provenance, sample geometry, or marker fields',()=>{
  const before=data();const next=workbenchTransfer(before,updateWorkbenchItem(workbenchTree(before),'track:walk',{name:'河谷实走',color:'#336699'}));
  assert.equal(next.tracks[0].source,'recorded');assert.deepEqual(next.tracks[0].segments,before.tracks[0].segments);
  assert.equal(next.tracks[0].createdAt,1000);assert.deepEqual(next.annotations,before.annotations);
  assert.equal(next.tracks[0].style.color,'#336699');
});
test('dissolve promotes only one level while delete explicitly removes contained records',()=>{
  const before=data(), tree=workbenchTree(before);
  const dissolved=workbenchTransfer(before,dissolveWorkbenchFolder(tree,'day'));
  assert.equal(dissolved.collections.assignments['track:walk'],'trip');assert.deepEqual(dissolved.tracks,before.tracks);
  const deleted=workbenchTransfer(before,removeWorkbenchItems(tree,new Set(['day'])));
  assert.equal(deleted.tracks.length,0);assert.deepEqual(deleted.annotations,before.annotations);
  assert.throws(()=>moveWorkbenchItems(tree,new Set(['trip']),'day'),/自身或下级/);
});
test('persist and undo preserve old optional metadata; conflicting edits cannot be overwritten',()=>{
  const storage=storeOf(data()), before=collectData(storage);
  const next=workbenchTransfer(before,dissolveWorkbenchFolder(workbenchTree(before),'trip'));
  const saved=saveWorkbench(before,next,storage);assert.equal(saved.collections.groups.some(g=>g.id==='trip'),false);
  assert.deepEqual(saveWorkbench(saved,before,storage),before);
  storage.setItem(FAVORITES_STORAGE,'[]');
  storage.setItem(COLLECTION_STORAGE,JSON.stringify({...before.collections,groups:[]}));
  assert.throws(()=>saveWorkbench(before,next,storage),/其他操作/);
});
test('storage quota failure rolls back all written stores before surfacing failure',()=>{
  const storage=storeOf(data()), before=collectData(storage), originals=new Map(storage.map);
  const setter=storage.setItem;let failed=false;
  storage.setItem=(key,value)=>{if(key===COLLECTION_STORAGE&&!failed){failed=true;throw new Error('quota');}setter(key,value);};
  const next=workbenchTransfer(before,removeWorkbenchItems(workbenchTree(before),new Set(['day'])));
  assert.throws(()=>saveWorkbench(before,next,storage),/未保存/);assert.deepEqual(storage.map,originals);
});
test('selected exports preserve nested folders and actual recorded-track image source',()=>{
  const before=data(),tree=workbenchTree(before),storage=storeOf(before);
  const keys=selectedWorkbenchKeys(tree,['day','track:walk']);assert.deepEqual(keys,['track:walk']);
  const images=workbenchImageRoutes(tree,keys);assert.equal(images[0].data.track.source,'recorded');
  assert.equal(images[0].data.name,'真实实走轨迹');
  const transfer=collectionTransfer(catalogEntries(before.favorites,before.tracks,before.annotations,[]).filter(e=>keys.includes(e.key)),{},storage);
  assert.deepEqual(transfer.tracks,before.tracks);assert.deepEqual(transfer.annotations,[]);
  assert.equal(transfer.collections.groups.find(g=>g.id==='day').parentId,'trip');
});
