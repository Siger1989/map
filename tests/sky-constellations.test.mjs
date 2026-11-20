import assert from 'node:assert/strict';
import test from 'node:test';
import { EquatorFromVector, Horizon, Observer, RotateVector, Rotation_EQJ_EQD, Vector, MakeTime } from 'astronomy-engine';
import catalog from '../modules/sky/constellations.catalog.json' with {type:'json'};
import { constellationFigures,constellationOptions,createConstellationFrame,drawConstellations,equatorialNodes,getConstellationDirection,getConstellationTarget } from '../modules/sky/constellations.ts';
import { createJourneyStars } from '../modules/sky/journeyStars.ts';
import { clipConstellationLink, nightStrength } from '../modules/sky/constellationsDrawing.ts';
import { projectSkyNodes,skyAxes } from '../modules/sky/constellationsCamera.ts';
import { makeTrackProjector } from '../modules/sky/skyTrackGeometry.ts';

const date=Date.UTC(2026,6,1,14,0), site={latitude:30.9,longitude:103.59,elevationM:900};
const radians=Math.PI/180;
const error=(a,b)=>Math.abs((a-b+540)%360-180);
const options={showConstellations:true,showMilkyWay:true,sunAltitudeDeg:-18};

function referenceDirection(ra,dec,timeMs,place) {
  const t=MakeTime(new Date(timeMs)), a=ra*radians, d=dec*radians;
  const eqj=new Vector(Math.cos(d)*Math.cos(a),Math.cos(d)*Math.sin(a),Math.sin(d),t);
  const eqd=EquatorFromVector(RotateVector(Rotation_EQJ_EQD(t),eqj));
  return Horizon(t,new Observer(place.latitude,place.longitude,place.elevationM),eqd.ra,eqd.dec);
}

test('88 IAU figures refer to actual HYG stars and have Chinese and Latin names',()=>{
  assert.equal(constellationOptions.length,88);
  assert.equal(new Set(constellationOptions.map(o=>o.id)).size,88);
  const hips=new Set(catalog.stars.map(([hip])=>hip));
  for(const o of catalog.constellations) {
    assert.ok(o.name.endsWith('座')&&o.latin.length>=3&&o.id.length===3);
    assert.ok(o.lines.length&&o.lines.every(l=>l.length>=2&&l.every(hip=>hips.has(hip))));
  }
});

test('Sirius and the Galactic center match an independent equator-of-date/Horizon conversion',()=>{
  for(const t of [date,Date.UTC(2050,1,1,4)])for(const place of [site,{latitude:-33.9,longitude:151.2,elevationM:5}]){
    const frame=createConstellationFrame(t,place);
    for(const [actual,ra,dec] of [[frame.directions[catalog.stars.findIndex(row=>row[0]===32349)],101.28716,-16.71612],
      [getConstellationTarget(frame,'milky-way'),266.41683,-29.0078]]){
      const expected=referenceDirection(ra,dec,t,place);
      assert.ok(error(actual.azimuthDeg,expected.azimuth)<.01);
      assert.ok(Math.abs(actual.altitudeDeg-expected.altitude)<.01);
    }
  }
});

test('all single-target directions agree with their frame and advance with date and location',()=>{
  const frame=createConstellationFrame(date,site);
  assert.strictEqual(createConstellationFrame(date+10,site),frame);
  for (const {id} of [...constellationOptions,{id:'milky-way'}]) {
    assert.deepEqual(getConstellationTarget(frame,id),getConstellationDirection(date,site,id));
  }
  assert.equal(getConstellationDirection(date,site,'invalid'),null);
  const a=getConstellationDirection(date,site,'Ori');
  const b=getConstellationDirection(date+3*3600000,site,'Ori');
  assert.ok(error(a.azimuthDeg,b.azimuthDeg)>10);
});

test('real Galactic pole is perpendicular to the line of sight toward Sgr A*',()=>{
  const f=createConstellationFrame(date,site);
  assert.ok(Math.abs(f.galacticCenter.reduce((sum,v,i)=>sum+v*f.galacticPole[i],0))<.001);
});

test('selected constellation projection follows solar/lunar camera projection including roll and zenith',()=>{
  const f=createConstellationFrame(date,site), optics={horizontalFov:67,verticalFov:82};
  for(const pose of [{azimuth:359,altitude:22,roll:76},{azimuth:180,altitude:89,roll:-117}]){
    const projected=projectSkyNodes(f.vectors,skyAxes(pose,optics),390,640), reference=makeTrackProjector(pose,optics,390,640);
    const local=skyAxes(pose,optics);
    const eq=projectSkyNodes(equatorialNodes,{...local,forward:f.equatorialAxis(local.forward),right:f.equatorialAxis(local.right),up:f.equatorialAxis(local.up)},390,640);
    for(let i=0;i<f.directions.length;i+=5){
      const expected=reference.point(f.directions[i]), actual=projected[i].point;
      assert.equal(Boolean(expected),Boolean(actual));
      if(expected)assert.ok(Math.hypot(expected.x-actual.x,expected.y-actual.y)<1e-8);
      assert.equal(Boolean(expected),Boolean(eq[i].point));
      if(expected)assert.ok(Math.hypot(expected.x-eq[i].point.x,expected.y-eq[i].point.y)<1e-8);
    }
  }
});

test('journey can synchronously draw only Orion, reuse a frame and clear the optional layer',()=>{
  const calls={stars:0,clears:0,labels:[]};
  const context={beginPath(){},moveTo(){},lineTo(){},stroke(){},restore(){},save(){},fill(){},setTransform(){},
    arc(){calls.stars++;},fillRect(){calls.stars++;},strokeText(){},fillText(t){calls.labels.push(t);},clearRect(){calls.clears++;}};
  const canvas={width:1,height:1,ownerDocument:{defaultView:{devicePixelRatio:2}},getContext:()=>context};
  const t=Date.UTC(2026,11,17,15),f=createConstellationFrame(t,site),o=getConstellationTarget(f,'Ori');
  const p={time:t,observer:site,pose:{azimuth:o.azimuthDeg,altitude:o.altitudeDeg,roll:0},optics:{horizontalFov:65,verticalFov:85},
    width:390,height:640,layers:{constellations:true,milkyWay:false,constellationId:'Ori'},sunAltitudeDeg:-18};
  const renderer=createJourneyStars(canvas,()=>{throw Error('unexpected asynchronous load');});
  assert.equal(renderer.draw(p),true);
  const initialStars=calls.stars,initialClears=calls.clears;
  assert.ok(initialStars>=5 && initialStars<=constellationFigures.find(figure=>figure.id==='Ori').members.length);
  assert.deepEqual(calls.labels,['猎户座']);
  assert.equal(renderer.draw(p),true);assert.equal(calls.clears,initialClears);
  renderer.draw({...p,layers:{...p.layers,constellationId:'all'}});
  assert.ok(calls.stars-initialStars>initialStars);
  const beforeDay=calls.clears;
  assert.equal(renderer.draw({...p,sunAltitudeDeg:7}),true);assert.equal(calls.clears,beforeDay+1);
  renderer.dispose();assert.equal(renderer.draw(p),false);
});

test('twilight strength fades; dark skies and sampled ridges control line visibility',()=>{
  assert.equal(nightStrength(5),0);assert.equal(nightStrength(-18),1);
  assert.ok(nightStrength(-6)>0&&nightStrength(-6)<nightStrength(-12));
  const a={azimuthDeg:359,altitudeDeg:10},b={azimuthDeg:1,altitudeDeg:20},ridge={...options,horizonAt:()=>15};
  assert.equal(clipConstellationLink(a,{azimuthDeg:2,altitudeDeg:5},ridge),null);
  const clipped=clipConstellationLink(a,b,ridge);assert.ok(Math.abs(clipped[0].altitudeDeg-15)<.1);assert.ok(error(clipped[0].azimuthDeg,0)<.1);
  drawConstellations(null,390,640,{azimuth:0,altitude:30,roll:0},{horizontalFov:60,verticalFov:75},createConstellationFrame(date,site),{...options,sunAltitudeDeg:15});
});
