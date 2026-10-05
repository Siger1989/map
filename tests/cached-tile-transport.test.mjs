import test from 'node:test';
import assert from 'node:assert/strict';
import { createCachedTileFetcher } from '../modules/mapSources/cachedTileTransport.ts';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]).buffer;
const tick=()=>new Promise(r=>setTimeout(r,20));
function store(){const values=new Map();return {values,get:async key=>values.get(key)?.slice(0),put:(key,b)=>values.set(key,b.slice(0)),forget:key=>values.delete(key)};}
test('same provider URL is reused across fetcher instances without storing its URL',async()=>{
  const cache=store();let calls=0;
  const network=async()=>{calls++;return new Response(png.slice(0),{headers:{'Content-Type':'image/png'}})};
  const first=createCachedTileFetcher(cache,network),signal=new AbortController().signal;
  assert.deepEqual(await(await first.fetch('https://fixture.invalid/tile?key=private',signal)).arrayBuffer(),png);
  await tick();
  const second=createCachedTileFetcher(cache,network);
  const hit=await second.fetch('https://fixture.invalid/tile?key=private',signal);
  assert.equal(hit.headers.get('X-Shantu-Browse-Cache'),'hit');assert.deepEqual(await hit.arrayBuffer(),png);
  assert.equal(calls,1);assert.match([...cache.values.keys()][0],/^raster-v1:[a-f0-9]{64}$/);
});
test('HTML, errors, no-store and cancelled downloads are never cached',async()=>{
  for(const mode of ['html','error','partial','no-store','abort']){
    const cache=store(),abort=new AbortController();
    const reader=createCachedTileFetcher(cache,async()=>{
      if(mode==='abort')abort.abort();
      return new Response(mode==='html'?'<!doctype html>':png.slice(0),{status:mode==='error'?503:mode==='partial'?206:200,headers:{'Cache-Control':mode==='no-store'?'no-store':'private, max-age=300'}});
    });
    await reader.fetch('https://fixture.invalid/'+mode,abort.signal);await tick();
    assert.equal(cache.values.size,0,mode);
  }
});
test('uses remaining freshness after Age and rejects expired or undecodable image bodies',async()=>{
  const previous=globalThis.createImageBitmap;
  try{
    let ttl,closed=0;
    globalThis.createImageBitmap=async()=>({close(){closed++}});
    const cache={...store(),put(_key,_bytes,value){ttl=value}};
    const signal=new AbortController().signal;
    await createCachedTileFetcher(cache,async()=>new Response(png.slice(0),{headers:{'Cache-Control':'max-age=60','Age':'15'}})).fetch('https://fixture.invalid/fresh',signal);
    await tick();assert.equal(ttl,45000);assert.equal(closed,1);
    ttl=undefined;
    await createCachedTileFetcher(cache,async()=>new Response(png.slice(0),{headers:{'Cache-Control':'max-age=60','Age':'60'}})).fetch('https://fixture.invalid/expired',signal);
    await tick();assert.equal(ttl,undefined);
    globalThis.createImageBitmap=async()=>{throw Error('decode failed')};
    await createCachedTileFetcher(cache,async()=>new Response(png.slice(0))).fetch('https://fixture.invalid/broken',signal);
    await tick();assert.equal(ttl,undefined);
  }finally{
    if(previous===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previous;
  }
});
test('cache failure falls through; bad cached body is removed and abort never fetches',async()=>{
  let calls=0,removed=0;const signal=new AbortController().signal;
  for(const cache of [{get:async()=>{throw Error('quota')},put(){},forget(){}},{get:async()=>new TextEncoder().encode('html').buffer,put(){},forget(){removed++}}]){
    await createCachedTileFetcher(cache,async()=>{calls++;return new Response(null)}).fetch('https://fixture.invalid/1',signal);
  }
  assert.equal(calls,2);assert.equal(removed,1);
  const abort=new AbortController();abort.abort();
  await assert.rejects(createCachedTileFetcher(store(),async()=>{calls++;return new Response(null)}).fetch('https://fixture.invalid/1',abort.signal),{name:'AbortError'});
  assert.equal(calls,2);
});
