import assert from 'node:assert/strict';
import test from 'node:test';
import {getSkyPosition} from '../modules/sky/astronomy.ts';
import {journeyInstant, journeyNextDay, journeyTimeAt, localMinute} from '../modules/sky/journeyClock.ts';
import {createJourneyPlayback, getJourneyPlaybackFrame} from '../modules/sky/journeyPlayback.ts';
import {routeSamples} from '../modules/sky/journeyRouteOverlay.ts';

const china = 'Asia/Shanghai';
const ny = 'America/New_York';
const hour = 3_600_000;

test('next local day crosses year-end, month-end and leap day', () => {
  for (const [departure,date] of [
    ['2026-11-30T18:05','2026-12-01'],
    ['2026-12-31T23:50','2027-01-01'],
    ['2028-02-28T23:15','2028-02-29'],
    ['2028-02-29T23:15','2028-03-01'],
  ]) {
    const day = journeyNextDay(departure,china);
    assert.equal(day.date,date);
    assert.equal(localMinute(day.startMs,china),date+'T00:00');
  }
});

test('next-day boundaries and playback respect both daylight-saving transitions', () => {
  const spring=journeyNextDay('2026-03-08T00:00',ny);
  const fall=journeyNextDay('2026-11-01T00:00',ny);
  assert.equal(spring.startMs-journeyInstant('2026-03-08T00:00',ny),23*hour);
  assert.equal(fall.startMs-journeyInstant('2026-11-01T00:00',ny),25*hour);
  const start=journeyInstant('2026-03-07T23:30',ny);
  const end=journeyInstant('2026-03-08T03:30',ny);
  assert.equal(end-start,3*hour);
  assert.equal(localMinute(journeyTimeAt(start,end,.5),ny),'2026-03-08T01:00');
  assert.equal(journeyInstant('2026-03-08T02:30',ny),null);
  assert.equal(journeyInstant('2026-11-01T01:30',ny),Date.UTC(2026,10,1,5,30));
});

test('midnight advances the date while the arrow and both halves of the highlighted line stay on the route', () => {
  const start=journeyInstant('2026-12-31T23:30',china);
  const end=journeyInstant('2027-01-01T00:30',china);
  const model=createJourneyPlayback({name:'跨年行程',segments:[[
    {coordinates:[103.58,30.89],timeMs:start},
    {coordinates:[103.586,30.891],timeMs:end},
  ]]});
  for (const [fraction,stamp] of [[0,'2026-12-31T23:30'],[.25,'2026-12-31T23:45'],[.5,'2027-01-01T00:00'],[1,'2027-01-01T00:30']]) {
    const time=journeyTimeAt(start,end,fraction);
    const frame=getJourneyPlaybackFrame(model,fraction*model.totalDistanceM);
    assert.equal(localMinute(time,china),stamp);
    assert.equal(frame.timeMs,time);
    const samples=routeSamples({model,frame});
    assert.deepEqual(samples.find(sample=>sample.distance===frame.distanceM).coordinate,frame.coordinates);
    if (fraction===.5) {
      assert.ok(samples[0].distance<frame.distanceM && samples.at(-1).distance>frame.distanceM);
      assert.ok(frame.headingDeg>0 && frame.headingDeg<90);
    }
  }
});

test('sun and moon keep moving through local midnight and use the arrival date', () => {
  const place={longitude:103.59,latitude:30.9,elevationM:800};
  const start=journeyInstant('2026-12-31T23:58',china);
  const end=journeyInstant('2027-01-01T00:02',china);
  const before=getSkyPosition(start,place);
  const after=getSkyPosition(journeyTimeAt(start,end,1),place);
  const prior=getSkyPosition(journeyInstant('2026-12-31T00:02',china),place);
  const radians=Math.PI/180;
  function separation(a,b){
    const altA=a.altitudeDeg*radians, altB=b.altitudeDeg*radians;
    const cosine=Math.sin(altA)*Math.sin(altB)+Math.cos(altA)*Math.cos(altB)*Math.cos((a.azimuthDeg-b.azimuthDeg)*radians);
    return Math.acos(Math.min(1,Math.max(-1,cosine)))/radians;
  }
  for(const key of ['sun','moon']){
    const moved=separation(before[key],after[key]);
    assert.ok(moved>.01 && moved<2, key+' moved '+moved+' degrees');
  }
  assert.ok(separation(prior.moon,after.moon)>5);
});
