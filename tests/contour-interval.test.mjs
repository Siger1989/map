import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { contourInterval, contourTileOptions, readContourInterval, saveContourInterval, CONTOUR_INTERVAL_KEY } from '../modules/terrain/contourInterval.ts';

test('30m is the finest vertical interval; changing it never changes the DEM resolution', () => {
  for(let z=7;z<=20;z++) for(const interval of [30,50,100,200]) {
    const options=contourTileOptions(interval,z);
    assert.equal(z-options.overzoom,Math.min(z,12));
    if(z>=14)assert.deepEqual(options.levels,[interval,interval*5]);
    if(z<10)assert.ok(options.levels[0]>=500);
  }
  for(const invalid of [undefined,10,20,60,120,NaN,'30'])assert.equal(contourInterval(invalid),30);
});
test('vertical interval persists and damaged storage uses 30m',()=>{
  let value='100';const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>{assert.equal(k,CONTOUR_INTERVAL_KEY);return value;},setItem:(k,v)=>{assert.equal(k,CONTOUR_INTERVAL_KEY);value=v;}}});
  try{assert.equal(readContourInterval(),100);saveContourInterval(50);assert.equal(readContourInterval(),50);value='{bad';assert.equal(readContourInterval(),30);}
  finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}
});
test('installed contour engine changes isoline geometry at 30/50/100m and reuses the same DEM',async()=>{
  const contour=createRequire(import.meta.url)('maplibre-contour');const requests=[];
  const manager=new contour.LocalDemManager({demUrlPattern:'https://fixture.invalid/{z}/{x}/{y}.png',encoding:'terrarium',maxzoom:12,cacheSize:40,timeoutMs:1000,
    getTile:async url=>{requests.push(url);return{data:new Blob()};},
    decodeImage:async()=>({width:256,height:256,data:Float32Array.from({length:256*256},(_,i)=>1000+(i%256)*8)})});
  const tiles=[];let count=0;
  for(const interval of [30,50,100]){
    const r=await manager.fetchContourTile(14,8192,8192,contourTileOptions(interval,14),new AbortController());
    tiles.push(Buffer.from(r.arrayBuffer));assert.ok(r.arrayBuffer.byteLength>0);
    if(count)assert.equal(requests.length,count);count=requests.length;
  }
  assert.notDeepEqual(tiles[0],tiles[1]);assert.notDeepEqual(tiles[1],tiles[2]);
  assert.ok(requests.every(url=>new URL(url).pathname.startsWith('/12/')));
});
