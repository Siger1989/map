import test from 'node:test';
import assert from 'node:assert/strict';
import { addSurveyStation, moveSurveyStation, newSurveyLine, projectSurveyPoint, surveyBasis, surveyCoordinate, surveyHeight, surveyKey, surveyRange, surveySettings, validSurveyTerrain, emptySurveyInfo } from '../modules/section/surveyLine.ts';
import { surveyContours } from '../modules/section/surveyContours.ts';
import { surveyDrawing } from '../modules/section/surveyDrawing.ts';
import { withSurveySettings } from '../modules/section/surveyStore.ts';
import { newAnnotation, ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
import { collectData, mergeData, validateTransfer } from '../modules/outdoor/exchange.ts';
import { catalogEntries } from '../modules/collections/catalog.ts';
import { workbenchTree, workbenchTransfer } from '../modules/collections/workbenchAdapter.ts';
import { flattenWorkbench, updateWorkbenchItem } from '../modules/collections/workbenchTree.ts';
import { collectionTransfer } from '../modules/collections/export.ts';
import { withoutEntries } from '../modules/collections/remove.ts';
import { saveWorkbench } from '../modules/collections/workbenchStore.ts';
import { COLLECTION_STORAGE, defaultLayout, validateLayout } from '../modules/collections/data.ts';
import { completeTabOrder, moveCollectionTab } from '../modules/collections/tabOrder.ts';
import { parseSavedMeasurements, SAVED_MEASUREMENTS_KEY } from '../modules/measurement/saved.ts';
import { SECTION_OBJECTS_KEY } from '../modules/section/sectionObjects.ts';

const line = () => newSurveyLine([104,30],[104.01,30]);
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const base = () => ({format:'guanyun-backup',version:1,tracks:[],annotations:[],favorites:[]});
const store = entries => { const m=new Map(entries);return {m,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}; };
const terrain = l => {
  const r=surveyRange(l),columns=9,rows=5;
  return {key:surveyKey(l),...r,columns,rows,halfWidth:l.halfWidth,zoom:12,sampledAt:1000,source:'合成测试地形',heights:Array.from({length:columns*rows},(_,i)=>100+i%columns*10)};
};

test('line snapping extends in both directions, preserving a single vertical plane',()=>{
  let l=line();l=addSurveyStation(l,[104.02,30.003],'c');l=addSurveyStation(l,[103.995,29.999],'d');
  assert.ok(l.stations[0].distance>surveyBasis(l).length);assert.ok(l.stations[1].distance<0);
  for(const s of l.stations) close(projectSurveyPoint(l,surveyCoordinate(l,s.distance)).offset,0);
  const settings=surveySettings(l);assert.equal(settings.plane.tilt,0);assert.equal(settings.plane.roll,0);
  assert.throws(()=>newSurveyLine([104,30],[104,30]),/间距/);
});
test('A/B rotate while other stations retain chainage, and slide mode preserves direction',()=>{
  const l=addSurveyStation(line(),[104.005,30.002],'c'), station=l.stations[0];
  const turned=moveSurveyStation(l,'B',[104,30.01],'direction');close(turned.stations[0].distance,station.distance);close(projectSurveyPoint(turned,surveyCoordinate(turned,station.distance)).offset,0);
  const moved=moveSurveyStation(l,'A',[104.001,30.02],'slide');close(surveyBasis(moved).bearing,surveyBasis(l).bearing);
  const prior=surveyCoordinate(l,station.distance),after=surveyCoordinate(moved,moved.stations[0].distance);prior.forEach((v,i)=>close(v,after[i],1e-8));
  assert.throws(()=>moveSurveyStation(l,'A',[104.02,30],'slide'),/不能跨过/);
  const c=moveSurveyStation(l,'c',[104.007,30.5],'direction');close(surveyCoordinate(c,c.stations[0].distance)[1],30);
});
test('date-line crossing takes the local short baseline and remains reversible',()=>{
  const l=newSurveyLine([179.99,20],[-179.99,20]);assert.ok(surveyBasis(l).length<3000);
  const p=surveyCoordinate(l,surveyBasis(l).length);close(p[0],-179.99,1e-7);close(projectSurveyPoint(l,p).distance,surveyBasis(l).length);
});
test('profile and contours use the same grid and do not bridge missing ground',()=>{
  const l=line(),grid=terrain(l),r=surveyRange(l);assert.ok(validSurveyTerrain(grid,l));
  close(surveyHeight(grid,(r.start+r.end)/2),140);
  const contours=surveyContours(grid,20);assert.ok(contours.some(c=>c.level===140));
  contours.find(c=>c.level===140).paths.flat().forEach(p=>close(p[0],4));
  const missing={...grid,heights:grid.heights.map((h,i)=>i%grid.columns===4?null:h)};
  assert.equal(surveyHeight(missing,(r.start+r.end)/2),null);assert.equal(surveyContours(missing,20).some(c=>c.level===140),false);
  assert.throws(()=>surveyContours(grid,.001),/过密/);
});
test('saved engineering sheet escapes entered information and prints real terrain provenance',()=>{
  const l={...line(),info:{...emptySurveyInfo(),title:'AB <图>',project:'勘查区 & 测试'}},grid=terrain(l);
  const output=surveyDrawing(l,grid,'一号剖面');assert.match(output.svg,/AB &lt;图&gt;/);assert.match(output.svg,/勘查区 &amp; 测试/);assert.match(output.svg,/合成测试地形/);assert.match(output.svg,/等高线平面图/);
});
test('saved measurements appear in favorites and retain all points through rename and export',()=>{
  const points=[{id:'a',coordinates:[104,30],altitude:100,heightSource:'terrain'},{id:'b',coordinates:[104.01,30],altitude:null,heightSource:'unknown'}];
  const item={id:'measure1',name:'测量 1',points,updatedAt:1000},storage=store([[SAVED_MEASUREMENTS_KEY,JSON.stringify({version:1,items:[item]})]]),before=collectData(storage);
  const tree=workbenchTree(before);assert.ok(flattenWorkbench(tree).some(i=>i.id==='measurement:measure1'));
  const next=workbenchTransfer(before,updateWorkbenchItem(tree,'measurement:measure1',{name:'边坡测量'}));assert.deepEqual(next.measurements[0].points,points);
  const after=saveWorkbench(before,next,storage);assert.equal(parseSavedMeasurements(storage.getItem(SAVED_MEASUREMENTS_KEY))[0].name,'边坡测量');
  const transfer=collectionTransfer(catalogEntries([],[],[],[],[],after.measurements),{},storage);assert.deepEqual(transfer.measurements,after.measurements);
  assert.equal(withoutEntries(after,['measurement:measure1']).measurements.length,0);saveWorkbench(after,before,storage);assert.equal(collectData(storage).measurements[0].name,'测量 1');
});
test('baseline rotation atomically repositions only associated markers and invalidates old terrain',()=>{
  const l=addSurveyStation(line(),[104.005,30],'marker'),settings={...surveySettings(l),objectId:'section1',surveyTerrain:terrain(l)};
  const marker={...newAnnotation('pin',surveyCoordinate(l,l.stations[0].distance),140,'marker'),sectionAnchor:{sectionId:'section1',distance:l.stations[0].distance}};
  const unrelated=newAnnotation('pin',[104.01,30],300,'source-B'),before={...base(),sections:[{id:'section1',name:'勘探线',settings}],annotations:[marker,unrelated]};
  const turned=surveySettings(moveSurveyStation(l,'B',[104,30.01],'direction'),settings),after=withSurveySettings(before,'section1',turned);
  assert.equal(after.sections[0].settings.surveyTerrain,undefined);assert.deepEqual(after.annotations[1],unrelated);assert.equal(after.annotations[0].sectionAnchor.distance,marker.sectionAnchor.distance);assert.equal(after.annotations[0].groundElevation,null);
  const detached=withoutEntries(after,['section:section1']);assert.equal(detached.annotations[0].sectionAnchor,undefined);assert.deepEqual(detached.annotations[0].coordinates,after.annotations[0].coordinates);
});
test('category order accepts old saves, rejects duplicates and survives measurement folder export',()=>{
  const order=moveCollectionTab(completeTabOrder(),'measurement',0),layout={...defaultLayout(),tabOrder:order};validateLayout(layout);
  assert.equal(layout.tabOrder[0],'measurement');assert.equal(new Set(completeTabOrder(['section'])).size,9);assert.throws(()=>validateLayout({...layout,tabOrder:['all','all']}));
  const storage=store([[COLLECTION_STORAGE,JSON.stringify(layout)]]);const before=collectData(storage),after=mergeData({...base(),collections:{...defaultLayout(),tabOrder:['section']}},storage);
  assert.deepEqual(after.collections.tabOrder,before.collections.tabOrder);
});
test('measurement import ID collisions preserve both records and remap assignments',()=>{
  const points=[{id:'a',coordinates:[104,30],altitude:100,heightSource:'terrain'},{id:'b',coordinates:[104.01,30],altitude:90,heightSource:'terrain'}];
  const first={id:'same',name:'本地',points,updatedAt:1},storage=store([[SAVED_MEASUREMENTS_KEY,JSON.stringify({version:1,items:[first]})]]);
  const result=mergeData({...base(),measurements:[{...first,name:'导入'}],collections:{version:1,groups:[{id:'folder',name:'测量',color:'#227744'}],assignments:{'measurement:same':'folder'},order:['measurement:same']}},storage);
  assert.equal(result.measurements.length,2);const incoming=result.measurements.find(m=>m.name==='导入');assert.notEqual(incoming.id,'same');assert.equal(result.collections.assignments[`measurement:${incoming.id}`],'folder');
});

test('section and marker collision remapping keeps both independent lines linked correctly',()=>{
  const a={...newAnnotation('pin',[104.005,30],100,'well'),name:'原标记',sectionAnchor:{sectionId:'line',distance:400}};
  const l={...line(),stations:[{id:'well',label:'C',distance:400}],pointData:{well:{name:a.name,note:'完整记录'}}};
  const original={id:'line',name:'原剖面',settings:{...surveySettings(l),objectId:'line'}};
  const storage=store([[ANNOTATION_STORAGE,JSON.stringify([a])],[SECTION_OBJECTS_KEY,JSON.stringify([original])]]);
  const merged=mergeData({...base(),annotations:[a],sections:[{...original,name:'导入剖面'}]},storage);
  const section=merged.sections.find(s=>s.name==='导入剖面'),marker=merged.annotations.find(m=>m.id!=='well');
  assert.equal(merged.annotations.length,2);assert.equal(section.settings.survey.stations[0].id,marker.id);assert.equal(marker.sectionAnchor.sectionId,section.id);
  assert.equal(section.settings.survey.pointData[marker.id].note,'完整记录');assert.equal(merged.annotations[0].sectionAnchor.sectionId,'line');
});
test('long information uses bounded continuation pages and a one metre line still has a legible plan',()=>{
  const l={...line(),pointData:{A:{name:'甲点',note:'边坡'.repeat(200)+'完整末尾'}}},output=surveyDrawing(l,terrain(l),'测试');
  const text=output.pages.slice(1).map(p=>[...p.svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(m=>m[1]).join('')).join('');
  assert.match(text,new RegExp('边坡'.repeat(200)+'完整末尾'));assert.ok(output.pages.every(p=>p.height<4000));
  const short=moveSurveyStation(line(),'B',[104.00002,30],'direction');assert.ok(short.halfWidth<1);
});
