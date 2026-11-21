import assert from 'node:assert/strict';
import test from 'node:test';
import { metresBetween } from '../modules/navigation/types.ts';
import { resolveJourneyCamera } from '../modules/sky/journeyCamera.ts';
import { createJourneyCameraRail } from '../modules/sky/journeyCameraRail.ts';
import { createJourneyPlayback, getJourneyPlaybackFrame, journeyCameraSettings } from '../modules/sky/journeyPlayback.ts';
import { earthAxis, earthPosition } from '../modules/sky/satelliteTerrainGeometry.ts';
import { shortestTurn } from '../modules/sky/skyPoseMotion.ts';

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

test('gimbal keeps a recorded zigzag on the true route and suppresses camera and arrow jolts', () => {
  const journey = createJourneyPlayback({ name: 'GPS jitter', segments: [Array.from({length: 61}, (_, i) => ({
    coordinates: [103.58 + (i % 2 ? .00005 : -.00005), 30.88 + i * .000045],
    elevationM: 500, timeMs: i * 1000,
  }))] });
  const filtered = journeyCameraSettings(journey, 15);
  const direct = { turnRadiusM: filtered.turnRadiusM };
  const terrain = { heightAt: () => 500, horizonAt: () => 0 };
  const rails = [createJourneyCameraRail(), createJourneyCameraRail()];
  const views = [[], []];
  for (let i = 0; i <= 900; i++) {
    const station = i / 900 * journey.totalDistanceM;
    const frames = [direct, filtered].map(settings => getJourneyPlaybackFrame(journey, station, settings));
    assert.deepEqual(frames[1].coordinates, frames[0].coordinates);
    assert.equal(frames[1].timeMs, frames[0].timeMs);
    assert.equal(frames[1].headingDeg, frames[0].headingDeg);
    frames.forEach((frame, j) => {
      const camera = rails[j].resolve(journey, frame, optics, terrain, 0);
      views[j].push({ camera, arrow: frame.arrowHeadingDeg });
    });
  }
  const peakTurn = (list, angle) => Math.max(...list.slice(1).map((view, i) =>
    Math.abs(shortestTurn(angle(list[i]), angle(view)))));
  assert.ok(peakTurn(views[1], view => view.camera.pose.azimuth) < .6 * peakTurn(views[0], view => view.camera.pose.azimuth));
  assert.ok(peakTurn(views[1], view => view.arrow) < .2 * peakTurn(views[0], view => view.arrow));
});

test('gimbal stays on frame through a hairpin, at the dateline, and after backward seeking', () => {
  const settings = journeyCameraSettings(route, 15);
  const terrain = { heightAt: (_lng, lat) => lat > 40 ? 2100 : 500, horizonAt: () => 0 };
  const rail = createJourneyCameraRail();
  const lastStation = route.segments[0].endDistanceM;
  const sample = (distance, resolver = rail) => {
    const frame = getJourneyPlaybackFrame(route, distance, settings);
    return { frame, camera: resolver.resolve(route, frame, optics, terrain, 0) };
  };
  const reference = [];
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  for (let i = 0; i <= 240; i++) {
    const { frame, camera } = sample(lastStation * i / 240);
    const eye = earthPosition(...camera.position, camera.altitude);
    const arrow = earthPosition(...frame.coordinates, camera.subjectAltitude + 2.5);
    const vector = arrow.map((value, j) => value - eye[j]);
    const forward = earthAxis(...camera.position, camera.pose.azimuth, camera.pose.altitude);
    const side = earthAxis(...camera.position, camera.pose.azimuth + 90, 0);
    assert.ok(dot(forward, vector) > 0);
    assert.ok(Math.abs(dot(side, vector) / dot(forward, vector)) < Math.tan(optics.horizontalFov * Math.PI / 360) * .90);
    if (i === 80 || i === 160) reference.push(camera);
  }
  const cut = sample(lastStation + .001);
  assert.equal(cut.frame.segmentIndex, 1);
  assert.equal(cut.camera.subjectAltitude, 2101);
  assert.ok(Math.abs(cut.frame.cameraTarget[0]) > 179.9);
  assert.deepEqual(sample(lastStation * 160 / 240).camera, reference[1]);
  assert.deepEqual(sample(lastStation * 80 / 240, createJourneyCameraRail()).camera, reference[0]);
});
