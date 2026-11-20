import assert from 'node:assert/strict';
import test from 'node:test';
import { metresBetween } from '../modules/navigation/types.ts';
import { resolveJourneyCamera } from '../modules/sky/journeyCamera.ts';
import { createJourneyCameraRail } from '../modules/sky/journeyCameraRail.ts';
import { createJourneyPlayback, getJourneyPlaybackFrame } from '../modules/sky/journeyPlayback.ts';

const points = coordinates => coordinates.map(coordinates => ({ coordinates }));
const route = createJourneyPlayback({ name:'valley', segments:[
  points([[104,30],[104,30.003],[104.0008,30.0036],[104,30.0042]]),
  points([[179.999,45],[-179.999,45]]),
] });
const optics = { horizontalFov:32, verticalFov:65 };
const valley = {
  heightAt: (_lng, lat) => 1000 - (lat - 30) * 111320 * .14,
  horizonAt: (_bearing, position) => position[1] > 30.0008 ? 14 : 0,
};
const frameAt = distance => getJourneyPlaybackFrame(route, distance, { turnRadiusM:30 });

test('terrain camera crosses the change between steep-valley boom solutions continuously', () => {
  const rail = createJourneyCameraRail();
  const old = [], follow = [];
  for(let d=0; d<=320; d+=.5) {
    const frame=frameAt(d);
    const original=resolveJourneyCamera(frame,optics,valley);
    const stable=rail.resolve(route,frame,optics,valley,0);
    old.push(original.distance);
    follow.push(metresBetween(stable.position,frame.coordinates));
    assert.ok(stable.altitude >= valley.heightAt(...stable.position) + 29 - 1e-8);
    assert.equal(stable.pose.roll,0);
  }
  const step = values => Math.max(...values.slice(1).map((v,i)=>Math.abs(v-values[i])));
  assert.ok(step(old)>10);
  assert.ok(step(follow)<2);
});

test('texture refinements cannot move a stopped camera and previously unavailable heights can recover', () => {
  const rail=createJourneyCameraRail();
  const frame=frameAt(110);
  const flat={heightAt:()=>800,horizonAt:()=>0};
  const ridge={heightAt:()=>800,horizonAt:()=>13};
  const empty=rail.resolve(route,frame,optics,{heightAt:()=>null},0);
  assert.equal(empty.altitude,null);
  const ready=rail.resolve(route,frame,optics,flat,1);
  assert.ok(ready.altitude>800);
  assert.notEqual(resolveJourneyCamera(frame,optics,flat).pose.altitude,resolveJourneyCamera(frame,optics,ridge).pose.altitude);
  assert.deepEqual(rail.resolve(route,frame,optics,ridge,2),ready);
});

test('60Hz playback, 24fps capture and direct scrubbing agree at equal station through a switchback', () => {
  const sample = hz => {
    const rail=createJourneyCameraRail(), result=[];
    for(let i=0; i<=hz*4; i++){
      const frame=frameAt(route.segments[0].endDistanceM*i/(hz*4));
      const camera=rail.resolve(route,frame,optics,valley,i);
      if(i%(hz/12)===0)result.push(camera);
    }
    return result;
  };
  const playback=sample(60), capture=sample(24);
  const same = (a,b) => {
    assert.ok(metresBetween(a.position,b.position)<.001);
    assert.ok(Math.abs(a.altitude-b.altitude)<.0001);
    assert.ok(Math.abs(a.pose.altitude-b.pose.altitude)<.0001);
  };
  for(let i=0;i<playback.length;i++)same(playback[i],capture[i]);
  const rail=createJourneyCameraRail();
  for(const i of [34,3,44,12]){
    const frame=frameAt(route.segments[0].endDistanceM*i/48);
    same(rail.resolve(route,frame,optics,valley,i),playback[i]);
  }
});

test('a disjoint segment starts on its own terrain even at the date line', () => {
  const rail=createJourneyCameraRail();
  const ground={heightAt:(_lng,lat)=>lat>40?2100:500,horizonAt:()=>0};
  rail.resolve(route,frameAt(20),optics,ground,0);
  const frame=frameAt(route.segments[0].endDistanceM+.0001);
  const camera=rail.resolve(route,frame,optics,ground,1);
  assert.equal(camera.subjectAltitude,2101);
  assert.ok(Math.abs(camera.altitude-2143)<.01);
  assert.ok(metresBetween(camera.position,frame.coordinates)<100);
  assert.ok(Math.abs(camera.position[0])>179.9);
});
