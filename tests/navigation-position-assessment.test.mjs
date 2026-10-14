import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNavigationPosition } from '../modules/guidance/positionAssessment.ts';
import { pathOf, pointAt } from '../modules/guidance/geometry.ts';
import { createSession, advance } from '../modules/guidance/session.ts';
import { createNavigationCueData, navigationReferenceJoinProgress } from '../modules/guidance/navigationCueGeometry.ts';

const path = pathOf([[104,30],[104,30.01]]);
const pos = (east, north) => [104 + east/(111320*Math.cos(Math.PI/6)), 30+north/111320];
const fix = (east, north, timestamp=10000, extras={}) => ({coordinates:pos(east,north),accuracy:8,timestamp,...extras});
test('lateral offset alone does not claim a main or service road',()=>{
  const result=assessNavigationPosition(path,100,20,fix(20,100),null,0);
  assert.equal(result.kind,'uncertain');assert.equal(result.allowReference,true);
  assert.equal(assessNavigationPosition(path,100,8,fix(8,100),null,0),undefined);
});
test('stable forward motion alongside the line permits a labelled reference',()=>{
  const result=assessNavigationPosition(path,120,20,fix(20,120),fix(20,100,5000),20);
  assert.equal(result.kind,'parallel');assert.equal(result.allowReference,true);
  assert.match(result.message,/待确认/);
});
test('moving away or backwards suppresses a misleading connector',()=>{
  assert.equal(assessNavigationPosition(path,100,40,fix(40,100),fix(20,100,5000),20).allowReference,false);
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100),fix(20,120,5000),20).kind,'away');
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100),fix(40,100,5000),40).kind,'uncertain','approaching the line is not moving away');
});
test('jitter, interrupted fixes and inaccurate/network positions cannot certify motion',()=>{
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100),fix(19,99,5000),20).kind,'uncertain');
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100,30000),fix(20,80,10000),20).kind,'uncertain');
  assert.equal(assessNavigationPosition(path,100,45,fix(45,100,10000,{accuracy:30}),null,0).allowReference,false);
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100,10000,{source:'network',provider:'ip'}),null,0).allowReference,false);
  assert.equal(assessNavigationPosition(path,100,120,fix(120,100),null,0).allowReference,false);
});
test('two consistent moving GPS courses can supply direction; a stationary heading cannot',()=>{
  const moving={heading:0,speed:2,headingAccuracy:15};
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100,10000,moving),fix(20,99,5000,moving),20).kind,'parallel');
  assert.equal(assessNavigationPosition(path,100,20,fix(20,100,10000,{heading:90,speed:0}),fix(20,99,5000,{heading:90,speed:0}),20).kind,'uncertain');
});
test('suppressed reference never advances display join and removes only reference features',()=>{
  const input={coordinates:path.points,position:pos(40,100),progress:100,accuracy:8,kind:'route',referenceAllowed:false};
  assert.equal(navigationReferenceJoinProgress(input,path),undefined);
  const result=createNavigationCueData(input);
  assert.equal(result.progress,100);assert.equal(result.referenceJoinProgress,undefined);
  assert.equal(result.data.features.some(x=>x.properties.role==='offset-reference'),false);
  assert.deepEqual(result.data.features.find(x=>x.properties.role==='ribbon').geometry.coordinates[0],pointAt(path,100));
});
test('assessment does not replace the existing continuous off-route gate or change progress',()=>{
  const route={coordinates:path.points,distance:path.length,duration:1000,mode:'pedestrian',snapped:[],steps:[],createdAt:0};
  const first=advance(createSession(route,0),fix(20,100,5000),5000);
  const next=advance(first,fix(40,100,10000),10000);
  assert.equal(next.positionAssessment.kind,'away');assert.equal(next.offRoute,false);
  assert.equal(next.progress,first.progress);
  const lost=advance(next,null,11000);assert.equal(lost.positionAssessment,undefined);assert.equal(lost.progress,next.progress);
});
