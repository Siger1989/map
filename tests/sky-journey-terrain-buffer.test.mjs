import assert from 'node:assert/strict';
import test from 'node:test';
import { createJourneyPlayback } from '../modules/sky/journeyPlayback.ts';
import { ancestor, closestLoadedTile, mergeTerrainPatches, planJourneyWindow, tileAt, windowCovers } from '../modules/sky/journeyTerrainBuffer.ts';
import { buildSatelliteMesh, sampledSurfaceHeight, surfaceHeight } from '../modules/sky/satelliteTerrainGeometry.ts';

const line = lengthKm => createJourneyPlayback({segments:[[
  {coordinates:[103.57,30.9]}, {coordinates:[103.57+lengthKm/95.4,30.9]},
]]});

test('a typical 7.34 km itinerary warms its entire route, including the final high resolution tile',()=>{
  const route=line(7.34), window=planJourneyWindow(route,0);
  assert.equal(window.end, route.totalDistanceM);
  assert.ok(windowCovers(window,route.totalDistanceM,route.totalDistanceM));
  const finish=route.segments[0].points.at(-1).coordinates;
  const detail=tileAt(...finish,17);
  assert.ok(window.detail.some(t=>t.key===detail.key));
  assert.ok(window.overview.some(t=>t.key===ancestor(detail,14).key));
  assert.ok(window.surroundings.some(t=>t.z===9));
});

test('bounded overlapping windows move with long routes and recalibrate after backward seeks',()=>{
  const route=line(80), first=planJourneyWindow(route,0);
  assert.ok(first.end>=5000 && first.end<=9000);
  assert.ok(!windowCovers(first,first.end-200,route.totalDistanceM));
  const next=planJourneyWindow(route,first.end-950), end=planJourneyWindow(route,route.totalDistanceM-10);
  assert.ok(next.start<first.end && next.end>first.end);
  assert.ok(!windowCovers(next,0,route.totalDistanceM));
  assert.equal(end.end,route.totalDistanceM);
  for(const view of [first,next,end]){
    const keys=[...view.surroundings,...view.overview,...view.detail].map(t=>t.key);
    assert.equal(new Set(keys).size,keys.length);
    assert.ok(keys.length<=130);
  }
});

test('a missing child uses its closest real covering tile, including the parent of a missing base tile',()=>{
  const tile=tileAt(103.577,30.898,17), root=ancestor(tile,8), regional=ancestor(tile,14);
  const data=new Map([[root.key,'root'],['17/0/0','unrelated']]);
  assert.equal(closestLoadedTile(tile,data),'root');
  data.set(regional.key,'regional');
  assert.equal(closestLoadedTile(tile,data),'regional');
  data.set(tile.key,'detail');
  assert.equal(closestLoadedTile(tile,data),'detail');
  assert.equal(closestLoadedTile(tile,new Map()),undefined);
});

test('the cached GPU triangle heights agree with the terrain sampler including boundaries',()=>{
  const heights=Float32Array.from({length:65536},(_,i)=>500+12*Math.sin((i%256)/8)+40*Math.cos((i>>8)/19));
  for(const z of [9,12,17]){
    const tile=tileAt(103.586,30.896,z), mesh=buildSatelliteMesh(tile,heights);
    for(const [x,y] of [[0,0],[1,1],[.314,.619],[.749,.308],[.99,.05]])
      assert.ok(Math.abs(sampledSurfaceHeight(mesh.samples,mesh.steps,x,y)-surfaceHeight(tile,heights,x,y))<.0002);
  }
});

test('four fallback regions render once while a loaded detail quadrant keeps its own imagery',()=>{
  const tile=tileAt(103.58,30.89,14), base={tile};
  const children=[];
  for(const dx of [0,1]) for(const dy of [0,1]){
    const z=tile.z+1, x=tile.x*2+dx, y=tile.y*2+dy;
    children.push({leaf:{z,x,y,key:`${z}/${x}/${y}`},mesh:base});
  }
  assert.deepEqual(mergeTerrainPatches(children),[{leaf:tile,mesh:base}]);
  children[0].mesh={tile:children[0].leaf};
  assert.equal(mergeTerrainPatches(children).length,4);
});
