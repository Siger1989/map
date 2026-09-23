import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { FitEncoder, FitBaseType as B } from 'fit-file-parser/encoder';
import { parseFile } from '../modules/dataTransfer/fileImport.ts';
import { parseGeoJson } from '../modules/dataTransfer/geoJsonImport.ts';
import { parseCsv } from '../modules/dataTransfer/csvImport.ts';
import { parseOviJson } from '../modules/dataTransfer/oviJsonImport.ts';
import { parseTcx } from '../modules/dataTransfer/tcxImport.ts';
import { parseFit } from '../modules/dataTransfer/fitImport.ts';

test('GeoJSON preserves lines, segments, names, heights, pins and closed areas', async()=>{
  const input={type:'FeatureCollection',features:[
    {type:'Feature',properties:{name:'分段'},geometry:{type:'MultiLineString',coordinates:[[[103,30,100],[103.001,30,110]],[[104,30,120],[104.001,30,130]]]}},
    {type:'Feature',properties:{name:'营地'},geometry:{type:'Point',coordinates:[103,30,80]}},
    {type:'Feature',properties:{name:'区域'},geometry:{type:'Polygon',coordinates:[[[103,30],[103.001,30],[103.001,30.001],[103,30]]]}}
  ]};
  const r=await parseFile(new File([JSON.stringify(input)],'a.geojson'));
  assert.equal(r.tracks[0].name,'分段');assert.equal(r.tracks[0].segments.length,2);
  assert.equal(r.tracks[0].samples[1][1].altitude,130);assert.equal(r.annotations[0].groundElevation,80);assert.equal(r.areas[0].boundary.length,4);
  assert.throws(()=>parseGeoJson({...input,crs:{properties:{name:'EPSG:3857'}}},'a'),/WGS84/);
  assert.throws(()=>parseGeoJson({type:'Point',coordinates:['103',30]},'a'),/必须/);
  assert.throws(()=>parseGeoJson({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]],[[0.1,0.1],[0.2,0.1],[0.1,0.2],[0.1,0.1]]]},'a'),/内洞/);
});

test('TCX Activity/Course preserve pauses, altitude/time and course points without connecting missing GPS',()=>{
  const pt=(n)=>`<Trackpoint><Time>2026-01-01T00:00:0${n}Z</Time><Position><LatitudeDegrees>30</LatitudeDegrees><LongitudeDegrees>${103+n/1000}</LongitudeDegrees></Position><AltitudeMeters>${100+n}</AltitudeMeters></Trackpoint>`;
  const xml=`<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>TCX路线</Name><Track>${pt(1)}${pt(2)}<Trackpoint><Time>2026-01-01T00:00:03Z</Time></Trackpoint>${pt(4)}${pt(5)}</Track><CoursePoint><Name>补水</Name><Position><LatitudeDegrees>30</LatitudeDegrees><LongitudeDegrees>103.004</LongitudeDegrees></Position></CoursePoint></Course></Courses></TrainingCenterDatabase>`;
  const r=parseTcx(new DOMParser().parseFromString(xml,'text/xml'),'a.tcx');
  assert.equal(r.tracks[0].segments.length,2);assert.equal(r.tracks[0].samples[1][0].altitude,104);
  assert.equal(r.tracks[0].samples[0][0].time,Date.parse('2026-01-01T00:00:01Z'));assert.equal(r.annotations[0].name,'补水');
});

test('CSV quoted labels, explicit coordinates, segments and marker rows are retained',async()=>{
  const csv='name,longitude,latitude,altitude,segment,type\r\n"山路,东",103,30,120,a,track\r\n"山路,东",103.001,30,121,a,track\r\n"山路,东",104,30,122,b,track\r\n"山路,东",104.001,30,123,b,track\r\n营地,103,30,90,,point';
  const r=await parseFile(new File([csv],'a.csv'));assert.equal(r.tracks[0].name,'山路,东');assert.equal(r.tracks[0].segments.length,2);assert.equal(r.annotations.length,1);
  assert.throws(()=>parseCsv('x,y\n103,30','a.csv'),/表头/);
  assert.throws(()=>parseCsv('lon,lat\n,30','a.csv'),/经度/);
  assert.throws(()=>parseCsv('lon,lat\n"103,30','a.csv'),/未闭合/);
});

test('OVJSN honors each object coordinate flag rather than nested camera flags',()=>{
  const root={ObjItems:[{Type:8,Object:{Name:'奥维线',ObjectDetail:{Gcj02:0,Obj3dView:{Gcj02:1},Latlng:[30,103,30.001,103.001]}}},{Object:{Type:7,Name:'奥维点',ObjectDetail:{Gcj02:1,Lat:39.915,Lng:116.404,Altitude:0}}}]};
  const r=parseOviJson(root,'a.ovjsn','auto');assert.deepEqual(r.tracks[0].segments[0][0],[103,30]);assert.equal(r.annotations[0].groundElevation,0);
  assert.ok(Math.abs(r.annotations[0].coordinates[0]-116.3977555)<1e-7);
  delete root.ObjItems[0].Object.ObjectDetail.Gcj02;assert.throws(()=>parseOviJson(root,'a.ovjsn','auto'),/坐标系/);
});

const field=(number,baseType,size,value)=>({number,baseType,size,value});
function fitSample(){
  const e=new FitEncoder({protocolVersion:0x20});e.writeMessage(0,[field(0,B.Enum,1,6)]);
  e.writeMessage(31,[field(5,B.String,FitEncoder.string('FIT course').length,FitEncoder.string('FIT course'))]);
  const time=FitEncoder.toFitTimestamp(new Date('2026-01-01T00:00:00Z'));
  for(let n=0;n<4;n++){
    if(n===2)e.writeMessage(21,[field(0,B.Enum,1,0),field(1,B.Enum,1,1),field(253,B.Uint32,4,time+n)],2);
    e.writeMessage(20,[field(0,B.Sint32,4,Math.round(30*2147483648/180)),field(1,B.Sint32,4,Math.round((103+n/1000)*2147483648/180)),field(2,B.Uint16,2,(100+n+500)*5),field(253,B.Uint32,4,time+n)],1);
  }
  return e.close();
}
test('FIT reads binary coordinates, meters, timestamps, name and timer breaks; CRC corruption is rejected',async()=>{
  const bytes=fitSample(),r=await parseFile(new File([bytes],'course.fit'));
  assert.equal(r.tracks[0].name,'FIT course');assert.equal(r.tracks[0].segments.length,2);
  assert.ok(Math.abs(r.tracks[0].segments[0][0][0]-103)<1e-6);assert.equal(r.tracks[0].samples[1][1].altitude,103);
  assert.equal(r.tracks[0].samples[0][0].time,Date.parse('2026-01-01T00:00:00Z'));
  const bad=bytes.slice();bad[bad.length-1]^=1;await assert.rejects(parseFit(bad,'a.fit'),/CRC/);
  await assert.rejects(parseFit(bytes.slice(0,-3),'a.fit'),/截断/);
});
