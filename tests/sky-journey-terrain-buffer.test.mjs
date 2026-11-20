import assert from 'node:assert/strict';
import test from 'node:test';
import { createJourneyPlayback, getJourneyPlaybackFrame } from '../modules/sky/journeyPlayback.ts';
import { ancestor, closestLoadedTile, journeyGroundFootprint, mergeTerrainPatches, planJourneyWindow, refineJourneyLeaves, tileAt, windowCovers } from '../modules/sky/journeyTerrainBuffer.ts';
import { buildSatelliteMesh, planSatelliteTiles, resampleAncestorDem, sampledSurfaceHeight, surfaceHeight, terrainHeight } from '../modules/sky/satelliteTerrainGeometry.ts';
import { buildTerrainTransitions, sampleTransition } from '../modules/sky/satelliteTerrainTransitions.ts';

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
  assert.ok(window.overview.some(t=>t.key===ancestor(detail,15).key));
  assert.ok(window.startup.some(t=>t.key===detail.key));
  assert.ok(window.detail.every(t=>window.startup.some(s=>s.key===t.key)));
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
    assert.ok(keys.length<=350);
  }
});

test('switchback foreground and both sides of the camera view are ready before an 8 km mountain drive',()=>{
  const coords=[[103.57,30.900],[103.592,30.901],[103.602,30.908],[103.582,30.913],[103.606,30.918],[103.583,30.916]];
  const model=createJourneyPlayback({segments:[coords.map((coordinates,i)=>({coordinates,elevationM:600+i*120}))]});
  const settings={turnRadiusM:model.totalDistanceM/30*.6}, fov=38;
  const plan=planJourneyWindow(model,0,fov,settings), planned=new Set(plan.startup.map(t=>t.key));
  assert.ok(model.totalDistanceM>7340 && plan.end>=7340);
  for(let distance=0;distance<plan.end;distance+=38){
    const frame=getJourneyPlaybackFrame(model,distance,settings);
    const targets=journeyGroundFootprint({model,frame},fov);
    const leaves=refineJourneyLeaves(planSatelliteTiles(...frame.cameraCoordinates,17),targets.detail);
    for(const near of targets.detail){
      assert.ok(planned.has(near.key),'must prewarm '+near.key+' at '+distance);
      assert.ok(leaves.some(t=>t.key===near.key),'must draw the real tile '+near.key);
    }
  }
});

test('near polar routes use a physically equivalent foreground resolution and bounded view',()=>{
  const model=createJourneyPlayback({segments:[[{coordinates:[179.99,78]}, {coordinates:[-179.8,78.01]}]]});
  const frame=getJourneyPlaybackFrame(model,100), view=journeyGroundFootprint({model,frame},65);
  assert.equal(view.detail[0].z,15);
  assert.ok(view.detail.length>0&&view.detail.length<30);
  const plan=planJourneyWindow(model,0,65);
  assert.ok(view.detail.every(t=>plan.detail.some(p=>p.key===t.key)));
  assert.ok(plan.startup.length<350);
});

test('missing z12 DEM uses the matching parent quadrant and preserves no-data',()=>{
  const child=tileAt(103.589,30.906,12), parent=ancestor(child,11);
  const heights=Float32Array.from({length:65536},(_,i)=>400+(i%256)*2+(i>>8)*3);
  const coarse=resampleAncestorDem(child,parent,heights);
  for(const [x,y] of [[0,0],[.01,.89],[.23,.66],[.98,.43]]){
    const u=(((child.x&1)+x)/2),v=(((child.y&1)+y)/2);
    assert.ok(Math.abs(terrainHeight(coarse,x,y)-terrainHeight(heights,u,v))<2);
  }
  assert.ok(resampleAncestorDem(child,parent,new Float32Array(65536).fill(NaN)).every(Number.isNaN));
});

test('the coarser slope joins a finer neighbour across a real width with geographic imagery coordinates',()=>{
  const make=(z,x,y,height)=>{
    const tile={z,x,y,key:`${z}/${x}/${y}`};
    const grid=buildSatelliteMesh(tile,new Float32Array(65536).fill(height));
    return {tile,samples:grid.samples,steps:grid.steps,origin:grid.origin,coarseDem:false};
  };
  const coarse=make(14,1000,1000,100), finer=make(15,2002,2000,220);
  const result=buildTerrainTransitions([{leaf:coarse.tile,mesh:coarse},{leaf:finer.tile,mesh:finer}]);
  assert.equal(result.draws.length,1);
  assert.equal(result.draws[0].mesh,coarse);
  const band=result.bands.get(coarse), u=1-band[0].inset[1];
  const heightAt=f=>sampleTransition(band,(1000+f)*8,(1000+.25)*8);
  assert.equal(heightAt(.5),null);
  assert.ok(Math.abs(heightAt(.9999)-220)<1);
  assert.ok(Math.abs(heightAt((1+u)/2)-160)<1);
  const us=[...result.vertices].filter((_,i)=>i%5===3);
  assert.ok(Math.max(...us)-Math.min(...us)>.05);
  const missing=make(15,2002,2000,NaN);
  const noEdge=buildTerrainTransitions([{leaf:coarse.tile,mesh:coarse},{leaf:missing.tile,mesh:missing}]);
  assert.equal(noEdge.draws.length,0);
  assert.equal(noEdge.bounds.size,0);
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
