import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRouteTilePriority, routeCacheTiles, tileFromUrl } from '../modules/outdoor/routeCachePolicy.ts';

const tile=(lon,lat,z)=>({z,x:Math.floor((lon+180)/360*2**z),y:Math.floor((1-Math.asinh(Math.tan(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180))/Math.PI)/2*2**z)});

test('route tile priority follows a corridor around vertices and segment interiors',()=>{
  const priority=makeRouteTilePriority([[0,0],[2,0]],1);
  assert.equal(priority(tile(1,0,8)),true,'interior segment tile is covered');
  assert.equal(priority(tile(1,0.03,8)),true,'nearby tile is inside the default corridor');
  assert.equal(priority(tile(1,1,12)),false,'distant tile is excluded');
});

test('route corridor wraps across the antimeridian and clamps polar coordinates',()=>{
  const priority=makeRouteTilePriority([[179.8,80],[-179.8,80]],1);
  assert.equal(priority(tile(179.9,80,8)),true);
  assert.equal(priority(tile(-179.9,80,8)),true);
  assert.equal(priority({z:8,x:128,y:30}),false);
  assert.equal(makeRouteTilePriority([[0,90],[1,90]])(tile(0.5,85,8)),true);
});

test('invalid coordinates break route segments and malformed queries fail closed',()=>{
  const priority=makeRouteTilePriority([[0,0],[1,0],[NaN,NaN],[100,0],[101,0]]);
  assert.equal(priority(tile(50,0,8)),false,'separator prevents an artificial connecting segment');
  assert.equal(priority(tile(1,0,8)),true);
  assert.equal(priority({z:30,x:0,y:0}),false);
  assert.equal(priority({z:4,x:-1,y:2}),false);
  assert.equal(makeRouteTilePriority([[NaN,4],[Infinity,0],[]])(tile(0,0,8)),false);
});

test('prefetch candidates stay route-adjacent, camera-relevant, and capped',()=>{
  const points=[];
  for(let i=0;i<2000;i++)points.push([-0.2+i*0.0002,0]);
  points.push([NaN,NaN], [70,40], [70.2,40]);
  const candidates=routeCacheTiles(points,[0,0],14,1,48);
  assert.ok(candidates.length>0&&candidates.length<=48);
  assert.ok(candidates.every(t=>t.z===14));
  assert.ok(candidates.every(t=>Math.abs(t.x-tile(0,0,14).x)<20),'distant route part is not fetched');
  assert.deepEqual(routeCacheTiles([[100,40],[101,40]],[0,0],14),[],'no global route bbox prefetch');
  assert.equal(routeCacheTiles([[0,0],[0.1,0]],[0,0],14,1,1).length,1);
});

test('long high-zoom routes are clipped to nearby camera corridor before sampling',()=>{
  const points=[[-10,0],[10,0]];
  for(const z of [18,20]){
    const candidates=routeCacheTiles(points,[0,0],z,1,48);
    assert.ok(candidates.length>0&&candidates.length<=48,`z${z} has bounded candidates`);
    assert.ok(candidates.some(t=>t.x===tile(0,0,z).x&&t.y===tile(0,0,z).y),`z${z} includes the camera tile`);
    const priority=makeRouteTilePriority(points,1);
    assert.ok(candidates.every(priority),'all candidates satisfy the route corridor policy');
  }
});

test('tile URL parser maps only known coordinate layouts',()=>{
  assert.deepEqual(tileFromUrl('https://example.test/api/terrain/12/3456/789.png'),{z:12,x:3456,y:789});
  assert.deepEqual(tileFromUrl('https://tiles.example/GoogleMapsCompatible/7/21/42.jpg'),{z:7,x:42,y:21});
  assert.deepEqual(tileFromUrl('https://tiles.example/GoogleMapsCompatible_Level12/12/21/42.jpeg'),{z:12,x:42,y:21});
  assert.deepEqual(tileFromUrl('https://tiles.example/12/3456/789.webp'),{z:12,x:3456,y:789});
  assert.deepEqual(tileFromUrl('https://tiles.example/wmts?TILEMATRIX=8&TILECOL=12&TILEROW=45'),{z:8,x:12,y:45});
  assert.equal(tileFromUrl('https://tiles.example/unknown/path'),undefined);
  assert.equal(tileFromUrl('https://tiles.example/%E0%A4%A/12/1/1.png'),undefined);
  assert.equal(tileFromUrl('https://tiles.example/12/9999/1.png'),undefined,'out-of-range coordinates rejected');
  assert.equal(tileFromUrl('not a url'),undefined);
});
