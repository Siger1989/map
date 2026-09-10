import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectTrackNodes } from '../modules/tracks/nodeOperations.ts';
import { mergeTrackArchives } from '../modules/tracks/mergeArchives.ts';
import { parseSavedTracks, MAX_SAVED_TRACKS } from '../modules/tracks/drawing.ts';
import { newAnnotation, parseAnnotations } from '../modules/annotations/data.ts';
import { newSurveyLine, addSurveyStation, surveySettings, surveyRange, surveyKey, surveyCoordinate, moveSurveyStation, removeSurveyStation } from '../modules/section/surveyLine.ts';
import { withSurveyMarker, withSurveySettings } from '../modules/section/surveyStore.ts';
import { surveyDrawing } from '../modules/section/surveyDrawing.ts';
import { surveyScaleWidth, SURVEY_PX_PER_MM } from '../modules/section/surveyScale.ts';
import { validateTransfer, mergeData, collectData } from '../modules/outdoor/exchange.ts';
import { ANNOTATION_STORAGE } from '../modules/annotations/data.ts';
import { SECTION_OBJECTS_KEY } from '../modules/section/sectionObjects.ts';
import { workbenchRegionTree, workbenchLeaves } from '../modules/collections/workbenchTree.ts';
import { APP_VERSION, APP_VERSION_CODE } from '../config/product.ts';
import { routeColorSections, sectionElevation } from '../modules/tracks/colorSections.ts';
import { makeRouteQr, readRouteQr } from '../modules/routeShare/qrCodec.ts';
import { qrTransfer } from '../modules/routeShare/qrImport.ts';
import { shareTrack, routeFileText } from '../modules/routeShare/data.ts';
import { trackStyleText, readTrackStyle } from '../modules/tracks/styleExchange.ts';
import { routeArchiveEntries } from '../modules/routeShare/archive.ts';
import { drawingRecord } from '../modules/tracks/archive.ts';
import { inheritEdgeColors } from '../modules/tracks/edgeColors.ts';
import { EMPTY_DRAFT, appendVertex } from '../modules/tracks/draft.ts';
const empty=()=>({format:'guanyun-backup',version:1,tracks:[],annotations:[],favorites:[]});
const a=[104,30],b=[104.001,30],c=[104.002,30],d=[104.003,30];
const track=(id,color,coordinates)=>({id,name:id,source:'manual',createdAt:1,segments:[coordinates],style:{color,width:2}});
const section=()=>{const line=addSurveyStation(newSurveyLine(a,d),b,'stationC');return {...empty(),sections:[{id:'section1',name:'测试剖面',settings:surveySettings(line)}]};};
const terrain=l=>({key:surveyKey(l),...surveyRange(l),halfWidth:l.halfWidth,columns:5,rows:3,heights:Array.from({length:15},(_,i)=>100+i%5*10),zoom:12,sampledAt:1,source:'合成测试地形'});
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};

test('100-route limit, displayed version and Android manifest share the intended release values',()=>{
  assert.equal(MAX_SAVED_TRACKS,100);
  const manifest=readFileSync(new URL('../mobile/android/AndroidManifest.xml',import.meta.url),'utf8');
  assert.ok(manifest.includes(`android:versionName="${APP_VERSION}"`));assert.ok(manifest.includes(`android:versionCode="${APP_VERSION_CODE}"`));
});
test('connect then merge is one archive and one continuous line, without duplicate edges or lost colours/markers',()=>{
  const red=track('red','#ff0000',[a,b]),blue=track('blue','#0000ff',[c,d]);
  const connected=connectTrackNodes(red,b,blue,c,'joined');assert.equal(connected.segments.length,1);
  const marker={...newAnnotation('pin',c,120,'marker1'),trackAnchor:{trackId:'blue',distance:0}};
  const before={...empty(),tracks:[red,blue,connected],annotations:[marker]};
  const after=mergeTrackArchives(before,'joined');
  assert.equal(after.tracks.length,1);assert.deepEqual(after.tracks[0].segments,[[a,b,c,d]]);
  assert.deepEqual(after.tracks[0].edgeColors,[['#ff0000','#ff0000','#0000ff']]);
  assert.equal(after.annotations[0].trackAnchor.trackId,'joined');assert.deepEqual(after.annotations[0].coordinates,c);
  assert.ok(after.annotations[0].trackAnchor.distance>0);assert.deepEqual(parseSavedTracks(JSON.stringify(after.tracks))[0].edgeColors,after.tracks[0].edgeColors);
  assert.equal(before.tracks.length,3);
});
test('merge still refuses real branches and gaps',()=>{
  const red=track('red','#ff0000',[a,b]),blue=track('blue','#0000ff',[b,c]),branch=track('branch','#00ff00',[b,[104.001,30.001]]);
  assert.throws(()=>mergeTrackArchives({...empty(),tracks:[red,blue,branch]},'red'),/分岔/);
  assert.throws(()=>mergeTrackArchives({...empty(),tracks:[red,track('loose','#0000ff',[c,d])]},'red'),/端点/);
});

test('same-colour notes from different archives survive the merge without overwriting',()=>{
  const first={...track('first','#ff0000',[a,b]),colorConditions:{'#ff0000':'碎石'}};
  const second={...track('second','#ff0000',[b,c]),colorConditions:{'#ff0000':'泥泞'}};
  const merged=mergeTrackArchives({...empty(),tracks:[first,second]},'first').tracks[0];
  assert.equal(merged.colorConditions['#ff0000'],'碎石；泥泞');
});

test('switching drawing colour preserves old edges, new edges use the chosen colour, and continuation retains notes',()=>{
  const red={color:'#ff0000',width:2},green={color:'#00ff00',width:2};
  let draft=appendVertex(appendVertex(EMPTY_DRAFT,a),b);
  draft={...draft,edgeColors:inheritEdgeColors(draft.segments,[{...draft,style:red}],red.color),colorConditions:{'#ff0000':'铺装','#00ff00':'非铺装'}};
  draft=appendVertex(draft,c);
  const saved=drawingRecord({...draft,nodes:[],style:green,id:'draft',name:'画线',createdAt:1,now:2});
  assert.deepEqual(routeColorSections(saved).map(s=>s.color),[red.color,green.color]);
  const continued=drawingRecord({segments:[[a,b,c,d]],nodes:[],style:green,prior:saved,id:'unused',name:'',createdAt:3,now:4});
  assert.deepEqual(continued.colorConditions,draft.colorConditions);
  assert.deepEqual(routeColorSections(continued).map(s=>s.color),[red.color,green.color]);
});
test('selected A/B/C models and boreholes use the selected station, with no duplicate station, and follow direction changes',()=>{
  for(const stationId of ['A','B','stationC']) {
    const before=section(),line=before.sections[0].settings.survey;
    const {next,annotation}=withSurveyMarker(before,'section1',[0,0],'borehole','well1',stationId);
    assert.equal(annotation.icon,'drill');assert.equal(annotation.borehole.depth,null);assert.equal(annotation.sectionAnchor.stationId,stationId);
    assert.equal(next.sections[0].settings.survey.stations.length,line.stations.length);
    assert.notDeepEqual(annotation.coordinates,[0,0]);
    const turned=surveySettings(moveSurveyStation(line,'B',[104,30.003],'direction'),before.sections[0].settings);
    const moved=withSurveySettings(next,'section1',turned).annotations[0];
    assert.ok(Math.abs(moved.coordinates[0]-104)<1e-9);
    assert.equal(moved.sectionAnchor.stationId,stationId);
  }
  const {next,annotation}=withSurveyMarker(section(),'section1',[0,0],'box','model1','stationC');
  assert.equal(annotation.kind,'box');assert.deepEqual(annotation.coordinates,surveyCoordinate(next.sections[0].settings.survey,annotation.sectionAnchor.distance));
  const removed=withSurveySettings(next,'section1',surveySettings(removeSurveyStation(next.sections[0].settings.survey,'stationC'),next.sections[0].settings));
  assert.equal(removed.annotations[0].sectionAnchor,undefined);assert.equal(removed.annotations[0].id,'model1');
});
test('borehole depth validates and survives backup collision import with station binding',()=>{
  const {next,annotation}=withSurveyMarker(section(),'section1',b,'borehole','well1','stationC');
  annotation.borehole.depth=100;
  const backup=validateTransfer(JSON.parse(JSON.stringify(next)));
  assert.equal(parseAnnotations(JSON.stringify(backup.annotations))[0].borehole.depth,100);
  assert.throws(()=>parseAnnotations(JSON.stringify([{...annotation,borehole:{depth:-5}}])));
  const storage=memory();storage.setItem(ANNOTATION_STORAGE,JSON.stringify([{...annotation,name:'本地同号'}]));storage.setItem(SECTION_OBJECTS_KEY,JSON.stringify({version:1,items:[]}));
  // Normal import remaps colliding marker identity, retaining the separate selected station ID.
  storage.removeItem(SECTION_OBJECTS_KEY);
  mergeData(backup,storage);const imported=collectData(storage).annotations.find(m=>m.name===annotation.name);
  assert.notEqual(imported.id,'well1');assert.equal(imported.sectionAnchor.stationId,'stationC');assert.equal(imported.borehole.depth,100);
});
test('scale changes horizontal geometry and sheet prints every station coordinate, bearing and measured borehole arrow',()=>{
  const {next,annotation}=withSurveyMarker(section(),'section1',b,'borehole','well1','stationC');annotation.borehole.depth=100;
  const line={...next.sections[0].settings.survey,printScale:2000},grid=terrain(line);
  const drawing=surveyDrawing(line,grid,'测试',next.annotations);
  assert.match(drawing.svg,/水平 1:2000/);assert.match(drawing.svg,/方向角 A→B 90°/);assert.match(drawing.svg,/钻井 100 m/);assert.match(drawing.svg,/class="borehole"/);
  for(const p of [a,b,d]) {assert.ok(drawing.svg.includes(p[0].toFixed(6)));assert.ok(drawing.svg.includes(p[1].toFixed(6)));}
  assert.ok(Math.abs(surveyScaleWidth(100,2000)/SURVEY_PX_PER_MM-50)<1e-8);
  assert.equal(surveyScaleWidth(100,4000)*2,surveyScaleWidth(100,2000));
  assert.throws(()=>surveyScaleWidth(50000,500),/无法容纳/);
  const unknown={...annotation,borehole:{depth:null}};const unknownDrawing=surveyDrawing(line,grid,'测试',[unknown]);assert.match(unknownDrawing.svg,/深度未填/);assert.doesNotMatch(unknownDrawing.svg,/class="borehole"/);
});
test('colour notes survive drawing, connect, merge, QR scan and the complete route package',()=>{
  const red={...track('red','#ff0000',[a,b]),colorConditions:{'#ff0000':'铺装路'}},green={...track('green','#00ff00',[c,d]),colorConditions:{'#00ff00':'非铺装 <碎石> & 小心'}};
  const connected=connectTrackNodes(red,b,green,c,'joined');
  const merged=mergeTrackArchives({...empty(),tracks:[red,green,connected]},'joined').tracks[0];
  assert.deepEqual(merged.colorConditions,{...red.colorConditions,...green.colorConditions});
  const share=shareTrack(merged),read=qrTransfer(readRouteQr(makeRouteQr(share).text)).track;
  assert.deepEqual(read.edgeColors,merged.edgeColors);assert.deepEqual(read.colorConditions,merged.colorConditions);assert.equal(read.style.color,merged.style.color);
  const files=routeArchiveEntries(share,[],new Blob(['image']));
  const backup=validateTransfer(JSON.parse(files.find(f=>f.path==='山兔路线.json').data));
  assert.deepEqual(backup.tracks[0].colorConditions,merged.colorConditions);
  for(const format of ['gpx','kml']) assert.match(routeFileText(share,format),/非铺装 &lt;碎石&gt; &amp; 小心/);
  assert.deepEqual(readTrackStyle(trackStyleText(merged),merged.segments).edgeColors,merged.edgeColors);
});
test('QR simplification preserves colour boundaries and notes rather than merging different road sections',()=>{
  const points=Array.from({length:2000},(_,i)=>[104+i*.00001,30+Math.sin(i*1.8)*.003]);
  const path={...track('long','#ff0000',points),edgeColors:[points.slice(1).map((_,i)=>i<999?'#ff0000':'#00ff00')],colorConditions:{'#00ff00':'非铺装'}};
  const value=readRouteQr(makeRouteQr(shareTrack(path)).text);
  assert.ok(value.tolerance>0);const sections=routeColorSections({...value,style:value.style});assert.equal(sections.length,2);
  const boundary=value.segments[0][value.edgeColors[0].findIndex(c=>c==='#00ff00')];
  assert.ok(Math.abs(boundary[0]-points[999][0])<1e-6);assert.equal(value.colorConditions['#00ff00'],'非铺装');
});
test('colour lengths align with height chart and missing ground does not bridge between colours or disconnected parts',()=>{
  const path={...track('two','#ff0000',[a,b,c]),edgeColors:[['#ff0000','#00ff00']],colorConditions:{'#00ff00':'土路'}};
  const sections=routeColorSections(path);assert.equal(sections.length,2);assert.equal(sections[1].condition,'土路');
  const total=sections.at(-1).end,profile=[{part:0,distance:0,coordinates:a,elevation:100},{part:0,distance:total,coordinates:c,elevation:200}];
  const first=sectionElevation(profile,sections[0]),second=sectionElevation(profile,sections[1]);
  assert.ok(Math.abs(first.at(-1).elevation-150)<.01);assert.equal(first.at(-1).distance,second[0].distance);
  assert.equal(sectionElevation([{...profile[0],elevation:null},profile[1]],sections[0]).at(-1).elevation,null);
  assert.deepEqual(sectionElevation(profile,{...sections[0],part:1}),[]);
});

test('region view flattens only unfiled while retaining custom folders and every item',()=>{
  const pin={id:'annotation:a',name:'点',kind:'pin',region:'四川',color:'#fff'};
  const other={...pin,id:'annotation:b'};
  const tree=[{id:'unfiled',name:'未分组',kind:'folder',color:'#fff',children:[pin]},{id:'custom',name:'调查组',kind:'folder',color:'#fff',children:[other]}];
  const projected=workbenchRegionTree(tree);
  assert.deepEqual(projected[0].children.map(i=>i.id),['annotation:a','custom']);
  assert.deepEqual(workbenchLeaves(projected),[pin,other]);assert.equal(tree[0].id,'unfiled');
});
