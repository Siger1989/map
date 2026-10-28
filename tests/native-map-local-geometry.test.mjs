import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNativeLocal, unprojectNativeLocal } from '../modules/map/native/localGeometry.ts';
import { NativeDemCache, invertMatrix4, projectWgs84, unprojectWgs84 } from '../modules/map/native/geometry.ts';

function fixture() {
  const inverse = [0,500,0,0, 0,0,500,0, -1000,0,0,0, 6378137,0,0,1];
  const makeFrame = (x,y) => ({ sequence:1, camera:{center:[0,0],zoom:9,pitch:0,bearing:0},
    viewProjection:invertMatrix4(inverse),inverseViewProjection:inverse,
    viewport:{x,y,width:600,height:400},cssScale:2,terrainEnabled:false,
    clipDepth:'minusOneToOne',demRevision:0,capturedAt:1 });
  const frames=new Map([['main',makeFrame(40,80)],['aux-1',makeFrame(760,980)]]);
  const dem=new NativeDemCache();
  // Exercise the production projection pair, rather than inventing a mock's coordinate contract.
  const client={cameraFrame:id=>frames.get(id)??null,geometry:id=>({
    project:coordinate=>projectWgs84(coordinate,frames.get(id),dem),
    unproject:point=>unprojectWgs84(point,frames.get(id),dem),
  })};
  return {client};
}

test('real projection stays map-local for independent nonzero viewport origins and DPR=2',()=>{
  const {client}=fixture();
  for(const id of ['main','aux-1']){
    const center=projectNativeLocal(client,id,[0,0]);
    assert.ok(Math.abs(center.x-150)<1e-8);
    assert.ok(Math.abs(center.y-100)<1e-8);
    const ground=unprojectNativeLocal(client,id,center);
    assert.ok(Math.abs(ground[0])<1e-8&&Math.abs(ground[1])<1e-8);
    const source=[0.001,0.001];
    const restored=unprojectNativeLocal(client,id,projectNativeLocal(client,id,source));
    assert.ok(Math.abs(restored[0]-source[0])<1e-8&&Math.abs(restored[1]-source[1])<1e-8);
  }
});

test('local geometry refuses unavailable frames and blocked projections',()=>{
  const {client}=fixture();
  assert.equal(projectNativeLocal(client,'missing',[1,2]),null);
  assert.equal(unprojectNativeLocal(client,'missing',{x:1,y:2}),null);
  client.geometry=()=>({project:()=>({status:'blocked'}),unproject:()=>({status:'blocked'})});
  assert.equal(projectNativeLocal(client,'main',[1,2]),null);
  assert.equal(unprojectNativeLocal(client,'main',{x:1,y:2}),null);
});
