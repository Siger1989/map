import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJourneyRouteOverlay, routeImageryFocus, routeSamples } from '../modules/sky/journeyRouteOverlay.ts';
import { getJourneyPlaybackFrame, createJourneyPlayback } from '../modules/sky/journeyPlayback.ts';
import { earthAxis, earthPosition, mercator, planSatelliteTiles } from '../modules/sky/satelliteTerrainGeometry.ts';

const points = coords => coords.map(coordinates => ({ coordinates }));
const model = createJourneyPlayback({ name: 'separated geometry', segments: [
  points([[103.57,30.904],[103.5703,30.905],[103.5701,30.906]]),
  points([[104,31],[104.001,31.001]]),
] });
const frame = getJourneyPlaybackFrame(model, 110);
const view = {
  eye: earthPosition(103.5696,30.9034,940),
  right: earthAxis(103.5696,30.9034,90,0),
  up: earthAxis(103.5696,30.9034,0,72),
  forward: earthAxis(103.5696,30.9034,0,-18),
  tanX: .37, tanY: .61, near: .75, far: 190_000, width:390,height:780,
};

test('local route uses the exact current point and does not connect geometry across segments', () => {
  const samples=routeSamples({model,frame});
  assert.deepEqual(samples.find(sample=>sample.distance===frame.distanceM).coordinate,frame.coordinates);
  assert.ok(samples.every(({coordinate})=>coordinate[0]<103.571));
  assert.ok(samples.some(sample=>sample.distance<frame.distanceM));
  assert.ok(samples.some(sample=>sample.distance>frame.distanceM));
});

test('projected route contains both progress colors and an outlined arrow at the sampled subject', () => {
  const geometry=buildJourneyRouteOverlay({model,frame},view,()=>880,880);
  for(const group of Object.values(geometry)){
    assert.ok(group.length >= 18);
    assert.ok(group.every(Number.isFinite));
  }
  const missing=buildJourneyRouteOverlay({model,frame},view,()=>null,null);
  assert.ok(Object.values(missing).every(group=>group.length===0));
  const split=buildJourneyRouteOverlay({model,frame},view,(_lng,lat)=>lat<30.9048?null:880,880);
  assert.ok(split.casing.length<geometry.casing.length);
  assert.equal(split.arrow.length,geometry.arrow.length);
});

test('dense recorded tracks use a bounded sampling window', () => {
  const route = createJourneyPlayback({name:'dense',segments:[points(Array.from({length:7000},(_,i)=>[103.57,30.90+i/1e6]))]});
  const position = getJourneyPlaybackFrame(route,400);
  assert.ok(routeSamples({model:route,frame:position}).length<=192);
});

test('closer route imagery reaches z17 with the same fixed tile budget', () => {
  const tiles=planSatelliteTiles(103.569,30.904,17);
  assert.ok(tiles.some(tile=>tile.z===17));
  assert.ok(tiles.length<=39);
  assert.ok(planSatelliteTiles(103.569,30.904).every(tile=>tile.z<=16));
});

test('z17 refinement follows the arrow and 180 metres ahead on the Qingcheng example', () => {
  const coords = [[103.5690,30.9040],[103.56851,30.90415],[103.56804,30.90442],
    [103.56758,30.90476],[103.56719,30.90512],[103.56671,30.90541],[103.56628,30.90553]];
  const model = createJourneyPlayback({ name: 'Qingcheng example', segments: [points(coords)] });
  for (const fraction of [0,.23,.47,.65,.9,1]) {
    const frame = getJourneyPlaybackFrame(model, fraction * model.totalDistanceM);
    const route = { model, frame };
    const plan = planSatelliteTiles(...frame.cameraCoordinates, 17, routeImageryFocus(route));
    assert.ok(plan.length <= 39);
    for (const { coordinate: [lng,lat], distance } of routeSamples(route)) {
      if (distance < frame.distanceM || distance > frame.distanceM + 180) continue;
      assert.ok(plan.some(tile => {
        const [x,y] = mercator(lng,lat,tile.z);
        return tile.z === 17 && Math.floor(x) === tile.x && Math.floor(y) === tile.y;
      }));
    }
  }
});
