import test from 'node:test';
import assert from 'node:assert/strict';
import { saveMeasurement, parseSavedMeasurements, writeSavedMeasurements } from '../modules/measurement/saved.ts';
import { measurementProfile } from '../modules/measurement/profile.ts';
import { pointLabel } from '../modules/measurement/data.ts';
import { mapPhotos } from '../modules/photos/association.ts';
import { patchAnnotation } from '../modules/annotations/editorSession.ts';
import { newAnnotation } from '../modules/annotations/data.ts';
const point = (id, coordinates, altitude=100) => ({id,coordinates,altitude,heightSource:altitude===null?'unknown':'terrain'});
const abc = [point('a',[104,30]),point('b',[104.001,30],120),point('c',[104.002,30],90)];
test('saved multi-point measurement snapshots survive reload and updates preserve record identity',()=>{
  const items=saveMeasurement([],abc,'one',1); abc[0].coordinates[0]=105;
  assert.equal(items[0].points[0].coordinates[0],104);abc[0].coordinates[0]=104;
  let disk; writeSavedMeasurements({setItem:(key,value)=>disk=value},items);
  assert.deepEqual(parseSavedMeasurements(disk),items);
  const changed=saveMeasurement(items,[...abc,point('d',[104.003,30])],'one',2);
  assert.equal(changed.length,1);assert.equal(changed[0].name,'测量 1');assert.equal(changed[0].points.length,4);assert.equal(items[0].points.length,3);
  assert.equal(saveMeasurement(changed,abc,'two',3).length,2);
});
test('malformed saved measurement and quota failures never silently report success',()=>{
  assert.throws(()=>saveMeasurement([],abc.slice(0,1),'one',1));
  assert.throws(()=>parseSavedMeasurements(JSON.stringify({version:1,items:[{id:'x',name:'x',updatedAt:1,points:[abc[0],abc[0]]}]})));
  assert.throws(()=>writeSavedMeasurements({setItem:()=>{throw new Error('QuotaExceeded');}},saveMeasurement([],abc,'one',1)),/QuotaExceeded/);
  assert.throws(()=>parseSavedMeasurements('{broken'));
});
test('engineering profile preserves missing heights, escapes labels and paginates continuous paths',()=>{
  const profile=measurementProfile(abc,'<script>alert(1)</script>');
  assert.equal(profile.pages,1); assert.match(profile.svg,/&lt;script&gt;/);assert.doesNotMatch(profile.svg,/<script>/);
  assert.match(profile.svg,/104.002000/);assert.match(profile.svg,/30.000000/);assert.match(profile.svg,/水平夹角/);assert.match(profile.svg,/未对沿线地形连续采样/);
  const unknown=measurementProfile([abc[0],point('unknown',[104.001,30],null)],'unknown');
  assert.match(unknown.svg,/海拔暂无/);assert.doesNotMatch(unknown.svg,/<line[^>]+class="measured"/);
  const long=Array.from({length:22},(_,i)=>point(String(i),[104+i*.001,30],100+i));
  assert.equal(measurementProfile(long,'long',2).pages,3);assert.match(measurementProfile(long,'long',1).svg,/104.010000/);assert.match(measurementProfile(long,'long',2).svg,/104.020000/);
  assert.throws(()=>measurementProfile(long,'long',3));assert.equal(pointLabel(26),'AA');assert.equal(pointLabel(199),'GR');
});
test('attached photo has one live marker coordinate and disappears with hidden/deleted marker',()=>{
  const photo={id:'photo',kind:'annotation',annotationId:'a',coordinates:[104,30]};
  const marker={id:'a',name:'行程标记',visible:true,coordinates:[105,31]};
  assert.deepEqual(mapPhotos([photo],[marker])[0].coordinates,[105,31]);assert.deepEqual(photo.coordinates,[104,30]);
  assert.deepEqual(mapPhotos([photo],[]),[]);assert.deepEqual(mapPhotos([photo],[{...marker,visible:false}]),[]);
  const free={...photo,id:'free',kind:'point'};assert.deepEqual(mapPhotos([free],[]),[free]);
});
test('route-anchored marker rejects independent movement but remains editable for name and notes',()=>{
  const marker={...newAnnotation('pin',[104,30],100,'marker'),trackAnchor:{trackId:'route',distance:10}};
  assert.throws(()=>patchAnnotation(marker,{coordinates:[105,31]}),/不能单独移动/);
  assert.equal(patchAnnotation(marker,{name:'营地'}).name,'营地');
  assert.deepEqual(patchAnnotation({...marker,trackAnchor:undefined},{coordinates:[105,31]}).coordinates,[105,31]);
});
