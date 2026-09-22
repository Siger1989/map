import test from 'node:test';
import assert from 'node:assert/strict';
import { slopeDegrees, formatSlope } from '../modules/routeAnalysis/displayUnits.ts';
import { speedColor, speedBands } from '../modules/routeAnalysis/travelMode.ts';
import { metricLineParts } from '../modules/routeAnalysis/metrics.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';
import { detailPatch } from '../modules/cartography/detailPatch.ts';
import { applyNativeProgress } from '../modules/outdoor/nativeOffline.ts';

test('grade presentation converts rise/run into signed angles without changing the data',()=>{
  assert.equal(formatSlope(100),'45.0°'); assert.equal(formatSlope(-100),'-45.0°');
  assert.equal(formatSlope(20),'11.3°');assert.equal(formatSlope(null),'数据不足');
  assert.ok(Math.abs(slopeDegrees(10)-5.71059)<0.0001);
});
test('motorcycle colouring differentiates road speeds and survives saved-track normalization',()=>{
  const base={id:'ride',name:'摩托测试',createdAt:1,source:'recorded',segments:[[[0,0],[0.001,0],[0.002,0]]],samples:[[{time:0,altitude:0},{time:10000,altitude:1},{time:15000,altitude:2}]],style:{color:'#ffb477',width:1.5,colorMode:'speed',travelMode:'motorcycle'}};
  const before=JSON.stringify(base), restored=parseSavedTracks(JSON.stringify([base]))[0];
  assert.equal(restored.style.travelMode,'motorcycle');assert.deepEqual(restored.samples,base.samples);
  assert.notEqual(speedColor(30,'motorcycle'),speedColor(70,'motorcycle'));
  assert.equal(speedColor(30,'walk'),speedColor(70,'walk'));
  assert.equal(speedBands('motorcycle').map(b=>b.label).join(','),'0–20,20–40,40–60,60–80,≥80');
  const parts=metricLineParts(base,'speed');assert.notEqual(parts[0].color,parts[1].color);
  assert.equal(JSON.stringify(base),before);assert.equal(speedColor(null,'motorcycle'),'#8b9699');
});
test('fixed detail covers small viewports fully, stays at the requested level and caps large views',()=>{
  const small=[103.519,30.799,103.521,30.801];const p=detailPatch(103.52,30.8,18,small);
  assert.ok(p.coordinates[0][0]<=small[0]&&p.coordinates[0][1]>=small[3]);
  assert.ok(p.coordinates[2][0]>=small[2]&&p.coordinates[2][1]<=small[1]);
  assert.ok(p.tiles.every(t=>t.z===18));
  for(const z of [1,13,18,22])for(const lat of [-85,0,85]){
    const wide=detailPatch(103.52,lat,z,[-180,-85,180,85]);assert.ok(wide.tiles.length<=144);
    assert.ok(wide.width*256<=4096 && wide.height*256<=4096);
    assert.ok(wide.tiles.every(t=>t.z===z&&t.x>=0&&t.y>=0&&t.x<2**z&&t.y<2**z));
  }
});
test('native progress is associated with its own package and completed cache survives restart',()=>{
  const trip={id:'a',urls:['1','2','3'],done:1,bytes:10,complete:false};
  assert.equal(applyNativeProgress(trip,{id:'b',done:3}),trip);
  const resumed=applyNativeProgress(trip,{id:'a',done:2,bytes:30,state:'paused'});
  assert.equal(resumed.done,2);assert.equal(resumed.complete,false);assert.equal(resumed.native,true);
  assert.equal(applyNativeProgress(resumed,{id:'a',done:3,bytes:50,state:'complete'}).complete,true);
});
