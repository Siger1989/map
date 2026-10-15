import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionHeading, reliableGpsCourse, travelBearing } from '../modules/position/motionHeading.ts';
import { readNativePosition } from '../modules/position/nativePosition.ts';
import { positionFix } from '../modules/position/types.ts';
const now=1800000000000;
const fix=(x=0,y=0,t=0,more={})=>({coordinates:[x,y],accuracy:3,timestamp:now+t,source:'gps',...more});

test('geographic travel bearing keeps north/east/south/west and the dateline correct',()=>{
  assert.equal(travelBearing([0,0],[0,0.001]),0);
  assert.equal(travelBearing([0,0],[0.001,0]),90);
  assert.equal(travelBearing([0,0],[0,-0.001]),180);
  assert.equal(travelBearing([0,0],[-0.001,0]),270);
  assert.equal(travelBearing([179.999,0],[-179.999,0]),90);
});
test('walking displacement establishes course while stationary jitter and poor fixes never invent one',()=>{
  const model=new MotionHeading();
  assert.equal(model.update(fix(),now).heading,null);
  assert.equal(model.update(fix(0.00001,0,1000),now+1000).heading,null);
  assert.equal(model.update(fix(0.0001,0,5000),now+5000).heading,90);
  assert.equal(model.update(fix(0.00011,0,6000,{speed:0,heading:270}),now+6000).heading,90);
  assert.equal(model.update(fix(0,0,7000,{source:'network',accuracy:100}),now+7000).heading,90);
  assert.equal(model.update(fix(0,0,8000,{accuracy:NaN}),now+8000).heading,90);
  assert.equal(model.update(null,now+9000).heading,90);
});
test('GPS course survives quiet acceleration at constant speed, wraps north, and rejects stale/poor headings',()=>{
  const model=new MotionHeading();
  assert.equal(model.update(fix(0,0,0,{heading:359,speed:2,headingAccuracy:5}),now,true).heading,359);
  const next=model.update(fix(0,0.00005,2000,{heading:3,speed:2,headingAccuracy:5}),now+2000,true).heading;
  assert.ok(next>=0&&next<3);
  assert.equal(model.update(fix(0,0,3000,{heading:180,speed:2,headingAccuracy:80}),now+3000).heading,next);
  assert.equal(model.update(fix(0,0,4000,{heading:180,speed:2}),now+30000).heading,next);
});
test('stationary drift keeps the last trusted direction instead of following GPS jitter',()=>{
  const model=new MotionHeading();
  assert.equal(model.update(fix(0,0,0,{heading:90,speed:3,headingAccuracy:5}),now).heading,90);
  for(let i=1;i<=8;i++){
    const next=model.update(fix(i*0.00001,0,i*1000,{heading:250,speed:0.2,accuracy:5}),now+i*1000,true);
    assert.equal(next.heading,90);
  }
});
test('low speed movement accumulates displacement before establishing a direction',()=>{
  const model=new MotionHeading();
  model.update(fix(0,0,0,{accuracy:4,speed:0.7}),now);
  assert.equal(model.update(fix(0.000018,0,2500,{accuracy:4,speed:0.7}),now+2500).heading,null);
  assert.equal(model.update(fix(0.000072,0,10000,{accuracy:4,speed:0.7}),now+10000).heading,90);
});
test('large sustained GPS turns require confirmation then follow promptly',()=>{
  const model=new MotionHeading();
  assert.equal(model.update(fix(0,0,0,{heading:0,speed:4,headingAccuracy:5}),now).heading,0);
  assert.equal(model.update(fix(0,0,1000,{heading:130,speed:4,headingAccuracy:5}),now+1000).heading,0);
  const turned=model.update(fix(0,0,2000,{heading:134,speed:4,headingAccuracy:5}),now+2000).heading;
  assert.ok(turned>90&&turned<134,`expected prompt turn toward 134°, got ${turned}`);
  const followed=model.update(fix(0,0,3000,{heading:135,speed:4,headingAccuracy:5}),now+3000).heading;
  assert.ok(followed>turned&&followed<135);
});

test('sparse fresh GPS updates can confirm a real turn without accepting one outlier',()=>{
  const model=new MotionHeading();
  model.update(fix(0,0,0,{heading:0,speed:4,headingAccuracy:5}),now);
  assert.equal(model.update(fix(0,0,6000,{heading:130,speed:4,headingAccuracy:5}),now+6000).heading,0);
  const heading=model.update(fix(0,0,12000,{heading:134,speed:4,headingAccuracy:5}),now+12000).heading;
  assert.ok(heading>90&&heading<134);
});
test('stale and low-accuracy points retain direction and cannot rotate it',()=>{
  const model=new MotionHeading();
  model.update(fix(0,0,0,{heading:45,speed:3,headingAccuracy:5}),now);
  assert.equal(model.update(fix(0,0,1000,{heading:180,speed:4,headingAccuracy:5}),now+12000).heading,45);
  assert.equal(model.update(fix(0,0,2000,{heading:180,speed:4,headingAccuracy:5,accuracy:31}),now+2000).heading,45);
  assert.equal(model.update(fix(0,0,3000,{heading:180,speed:4,headingAccuracy:80}),now+3000).heading,45);
});
test('missing bearing accuracy is not treated as perfect and IP estimates never establish course',()=>{
  const weak=fix(0,0,0,{heading:90,speed:2.5,accuracy:25});
  assert.equal(reliableGpsCourse(weak),null);
  assert.equal(reliableGpsCourse({...weak,accuracy:8}),90);
  assert.equal(reliableGpsCourse({...weak,headingAccuracy:36,accuracy:3}),null);
  const model=new MotionHeading();
  assert.equal(model.update({...weak,provider:'ip'},now).heading,null);
  assert.equal(model.update(weak,now).heading,null);
});
test('missing GPS course falls back to bounded displacement; jumps and duplicate fixes cannot rotate map',()=>{
  const model=new MotionHeading();model.update(fix(),now);
  assert.equal(model.update(fix(1,0,1000),now+1000).heading,null);
  assert.equal(model.update(fix(1.0001,0,6000),now+6000).heading,90);
  assert.equal(model.update(fix(1,0,6000,{heading:270,speed:2}),now+6000).heading,90);
  const still=new MotionHeading();still.update(fix(0,0,0,{accuracy:5}),now);
  assert.equal(still.update(fix(0.00009,0,5000,{accuracy:5}),now+5000,true).heading,null);
});
test('native and browser fixes retain optional GPS course while old fixes stay compatible',()=>{
  const coords={longitude:0,latitude:0,accuracy:3,speed:2,heading:90};
  assert.equal(positionFix({coords,timestamp:now}).heading,90);
  const native=readNativePosition(JSON.stringify({fix:{...coords,timestamp:now,source:'gps',headingAccuracy:7}}),now).fix;
  assert.equal(native.speed,2);assert.equal(native.headingAccuracy,7);
  const old=positionFix({coords:{longitude:0,latitude:0,accuracy:3,speed:null,heading:null},timestamp:now});
  assert.equal('heading' in old,false);assert.equal('speed' in old,false);
});


test('walking GPS course waits for net movement and ignores a small heading deadband',()=>{
  const model=new MotionHeading();
  model.update(fix(0,0,0,{heading:0,speed:1.8,accuracy:5,headingAccuracy:5}),now);
  for(let i=1;i<6;i++) assert.equal(model.update(fix(i%2*0.00001,0,i*1000,{heading:i%2?45:315,speed:1.8,accuracy:5,headingAccuracy:5}),now+i*1000).heading,0);
  assert.equal(model.update(fix(0,0.00006,6000,{heading:2,speed:1.8,accuracy:5,headingAccuracy:5}),now+6000).heading,0);
  const turning=model.update(fix(0.00006,0.00006,10000,{heading:40,speed:1.8,accuracy:5,headingAccuracy:5}),now+10000).heading;
  assert.ok(turning>0&&turning<40);
});
