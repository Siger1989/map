import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptSkyPose, displayedSkyPose, shortestTurn } from '../modules/sky/skyPoseMotion.ts';
import { createJourneyPlayback, getJourneyPlaybackFrame } from '../modules/sky/journeyPlayback.ts';

const pose = (azimuth, altitude = 0, roll = 0) => ({ azimuth, altitude, roll });
const delta = (a,b) => Math.abs(shortestTurn(a,b));

test('yaw and roll cross north on the short arc while pitch stays linear', () => {
  const start = acceptSkyPose(null, pose(358,2,179), 'sensor', 100, 85000);
  const end = acceptSkyPose(start, pose(2,14,-179), 'sensor', 150, 85050);
  const halfway = displayedSkyPose(end,175);
  assert.ok(delta(halfway.azimuth,0)<.001);
  assert.ok(delta(halfway.roll,180)<.001);
  assert.equal(halfway.altitude,8);
  assert.deepEqual(displayedSkyPose(end,202),end.to);
});

test('60 Hz display resamples a 20 Hz sensor stream with bounded delay', () => {
  let motion = null;
  const old = [], shown = [], lags = [];
  for (let tick=0; tick<180; tick++) {
    const time = tick*1000/60;
    if (tick % 3 === 0) motion = acceptSkyPose(motion,pose((330+.09*time)%360),'sensor',time,10000+time);
    old.push(motion.to.azimuth);
    shown.push(displayedSkyPose(motion,time).azimuth);
    if(tick>4) lags.push(delta(shown.at(-1),(330+.09*time)%360)/.09);
  }
  const maxStep = series => Math.max(...series.slice(4).map((b,i)=>delta(series[i+3],b)));
  assert.ok(Math.abs(maxStep(old)-4.5)<.01);
  assert.ok(maxStep(shown)<1.501);
  assert.ok(Math.max(...lags)<50.01);
});

test('new pointer positions start from what was displayed and settle without overshoot', () => {
  const a = acceptSkyPose(null,pose(330,3,0),'drag',0);
  const b = acceptSkyPose(a,pose(14,7,0),'drag',20);
  const beforeRedirect = displayedSkyPose(b,30);
  const c = acceptSkyPose(b,pose(28,-2,0),'drag',30);
  assert.deepEqual(displayedSkyPose(c,30),beforeRedirect);
  assert.equal(displayedSkyPose(c,42),c.to);
  const stop = acceptSkyPose(c,c.to,'drag',42);
  assert.equal(displayedSkyPose(stop,200),c.to);
});

test('out-of-order samples are ignored, dropped samples and explicit jumps snap', () => {
  const a = acceptSkyPose(null,pose(90),'sensor',20,4000);
  assert.equal(acceptSkyPose(a,pose(0),'sensor',35,3900),a);
  for(const [elapsed,stamp] of [[260,4250],[25,4250]]) {
    const b=acceptSkyPose(a,pose(280),'sensor',elapsed,stamp);
    assert.equal(displayedSkyPose(b,elapsed),b.to);
  }
  const target=acceptSkyPose(a,pose(270),'snap',40);
  assert.equal(displayedSkyPose(target,40),target.to);
});

test('tilting through zenith or nadir keeps the physical lens facing the pole', () => {
  for (const sign of [-1,1]) {
    const a = acceptSkyPose(null,pose(10,89*sign,0),'sensor',0);
    const b = acceptSkyPose(a,pose(190,89*sign,-180),'sensor',40);
    assert.deepEqual(displayedSkyPose(b,60),pose(10,90*sign,0));
    const after=displayedSkyPose(b,70);
    assert.deepEqual(after,pose(190,89.5*sign,-180));
  }
});

const p = (x,y) => ({coordinates:[x,y]});
test('camera turns continuously through a corner while the motion arrow stays on the real edge', () => {
  const model=createJourneyPlayback({name:'bend',segments:[[p(0,0),p(0,.002),p(.002,.002)]]});
  const turn = model.segments[0].points[1].distanceM;
  const frames=Array.from({length:101},(_,i)=>getJourneyPlaybackFrame(model,turn-25+i*.5,{turnRadiusM:20}));
  const deltaMax = field => Math.max(...frames.slice(1).map((f,i)=>delta(frames[i][field],f[field])));
  assert.ok(deltaMax('headingDeg')>89);
  assert.ok(deltaMax('cameraHeadingDeg')<2.3);
  assert.ok(Math.abs(frames[50].cameraHeadingDeg-45)<.001);
  assert.ok(delta(frames[0].cameraHeadingDeg,0)<.001 && delta(frames.at(-1).cameraHeadingDeg,90)<.001);
  assert.deepEqual(getJourneyPlaybackFrame(model,turn,{turnRadiusM:20}),frames[50]);
});

test('short turns across north never spin, and random seeks never blend across a route break', () => {
  const model=createJourneyPlayback({name:'north', segments:[[p(.0004,0),p(0,.001),p(.0004,.002)],[p(45,10),p(44.998,10)]]});
  const turn=model.segments[0].points[1].distanceM;
  assert.ok(delta(getJourneyPlaybackFrame(model,turn).cameraHeadingDeg,0)<.005);
  const next=getJourneyPlaybackFrame(model,model.segments[1].startDistanceM+.1,{turnRadiusM:2400});
  assert.equal(next.segmentIndex,1);
  assert.ok(delta(next.headingDeg,next.cameraHeadingDeg)<.001);
});
