import assert from 'node:assert/strict';
import test from 'node:test';
import {findSkyTargetPreview, getSkyTargetGuide} from '../modules/sky/moonGuideGeometry.ts';

test('a selected solar or stellar target supplies its own name and direction',()=>{
  const terrain={coverage:1,status:'complete',observerAltitudeMeters:1,
    directions:Array.from({length:360},(_,azimuthDeg)=>({azimuthDeg,altitudeDeg:5,distanceMeters:100,elevationMeters:10}))};
  const optics={horizontalFov:56,verticalFov:70},pose={azimuth:10,altitude:18,roll:0};
  const view={terrain,optics,pose,width:390,height:780};
  const sun=getSkyTargetGuide({...view,direction:{azimuthDeg:10,altitudeDeg:18},label:'太阳'});
  assert.equal(sun.state,'visible');assert.equal(sun.message,'太阳在画面内');
  assert.equal(getSkyTargetGuide({...view,direction:{azimuthDeg:10,altitudeDeg:1},label:'银河中心'}).message,'银河中心在山脊后');
  assert.equal(getSkyTargetGuide({...view,direction:{azimuthDeg:10,altitudeDeg:-2},label:'猎户座'}).message,'猎户座在地平线下');
});

test('night target search finds an above-horizon position after twilight on the selected local day',()=>{
  const perMinute=60000;
  const day={startMs:0,endMs:60*perMinute},direction=()=>({azimuthDeg:40,altitudeDeg:12});
  const result=findSkyTargetPreview(day,null,0,direction,t=>t>=18*perMinute);
  assert.equal(result.status,'found');assert.equal(result.relation,'next');
  assert.ok(Math.abs(result.timeMs-18*perMinute)<=1000);
  assert.equal(result.flatReference,true);
  assert.equal(findSkyTargetPreview(day,null,0,direction,()=>false).status,'none');
});
