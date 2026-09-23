import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionHeading, travelBearing } from '../modules/position/motionHeading.ts';
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
  const next=model.update(fix(0,0,2000,{heading:1,speed:2}),now+2000,true).heading;
  assert.ok(next>359&&next<360);
  assert.equal(model.update(fix(0,0,3000,{heading:180,speed:2,headingAccuracy:80}),now+3000).heading,next);
  assert.equal(model.update(fix(0,0,4000,{heading:180,speed:2}),now+30000).heading,next);
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
