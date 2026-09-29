import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createBrowseCacheEngine } from '../modules/outdoor/browseCache.ts';

const bundle = await build({
  stdin: { contents: `export {cachedMapFetch} from './modules/outdoor/tileCache.ts'; export {fetchMapTile,fetchOnlineMapTile} from './modules/mapSources/tileTransport.ts'; export {offlineTransform} from './modules/outdoor/offline.ts';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'cache-backend', setup(b) {
    b.onResolve({ filter: /browseCache\.ts$/ }, () => ({ path: 'cache', namespace: 'backend' }));
    b.onLoad({ filter: /.*/, namespace: 'backend' }, () => ({ contents: 'export const browseCachedFetch=(...args)=>globalThis.__browseCacheTest.browseCachedFetch(...args);' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);

test('online direct/proxied tiles survive revisits and offline mode; clearing leaves manual packages alone', async () => {
  const originals = new Map(['window','localStorage','caches','fetch','__browseCacheTest'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]));
  const entries = new Map();
  const storage = {
    get: async k => entries.get(k),
    write: async e => entries.set(e.key,e),
    touch: async (key, lastAccess) => { const e=entries.get(key); if(e) entries.set(key,{...e,lastAccess}); },
    list: async () => [...entries.values()].map(({body,...m})=>({...m,bytes:body.byteLength})),
    remove: async keys => keys.forEach(k=>entries.delete(k)), clear: async()=>entries.clear(),
  };
  const manual = new Map([['http://test.local/api/terrain/1/0/0.png',new Response(png,{headers:{'Content-Type':'image/png'}})]]);
  let offline=false, requests=0, now=1000;
  const install=(key,value)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  install('window',{location:{origin:'http://test.local'}});
  install('localStorage',{getItem:key=>key==='shantu.offline-map-only.v1'?String(offline):null});
  install('caches',{open:async()=>({match:async key=>manual.get(key)?.clone()})});
  const engine=createBrowseCacheEngine({storage,now:()=>now}); install('__browseCacheTest',engine);
  install('fetch',async url=>{ requests++; if(offline)throw Error('unexpected network'); return String(url).includes('openfreemap.org/planet') ? Response.json({tiles:['https://tiles.example.test/{z}/{x}/{y}.pbf']}) : new Response(png,{headers:{'Content-Type':'image/png','Cache-Control':'max-age=86400'}}); });
  const signal=new AbortController().signal;
  try {
    const publicTile='https://tiles.example.test/9/403/192.png';
    const importedTile='https://imported.example.test/9/403/192.jpg';
    assert.match(api.offlineTransform(publicTile,'Tile').url,/^tripcache:/);
    assert.equal(api.offlineTransform('https://weather.example.test/data.json','Source').url,'https://weather.example.test/data.json');
    await (await api.cachedMapFetch(publicTile,signal,undefined,true)).arrayBuffer();
    await (await api.fetchMapTile(importedTile,signal,{z:9,x:403,y:192})).arrayBuffer();
    await (await api.cachedMapFetch('https://tiles.openfreemap.org/planet',signal,undefined,true)).json();
    await engine.flush(); assert.equal(requests,3);
    await (await api.fetchOnlineMapTile(importedTile,signal)).arrayBuffer();
    assert.equal(requests,3,'manual downloading reuses fresh browsed tiles without another request');
    await (await api.cachedMapFetch('https://tiles.example.test/9/404/192.png',signal)).arrayBuffer();
    await engine.flush();
    assert.equal(entries.size,3,'profile/elevation reads do not populate viewed-tile cache');
    assert.equal(requests,4);
    offline=true;
    now+=2*86400*1000;
    assert.deepEqual(new Uint8Array(await (await api.cachedMapFetch(publicTile,signal)).arrayBuffer()),png);
    assert.deepEqual(new Uint8Array(await (await api.fetchMapTile(importedTile,signal)).arrayBuffer()),png);
    assert.equal((await (await api.cachedMapFetch('https://tiles.openfreemap.org/planet',signal)).json()).tiles.length,1);
    assert.equal(requests,4);
    await engine.clearBrowseCache();
    await assert.rejects(()=>api.fetchMapTile(importedTile,signal),/未缓存/);
    const saved=await api.cachedMapFetch('/api/terrain/1/0/0.png',signal);
    assert.deepEqual(new Uint8Array(await saved.arrayBuffer()),png);
    manual.set(importedTile,new Response(png,{headers:{'Content-Type':'image/png'}}));
    const importedSaved=await api.fetchMapTile(importedTile,signal,{z:9,x:403,y:192});
    assert.deepEqual(new Uint8Array(await importedSaved.arrayBuffer()),png);
    assert.equal(manual.size,2); assert.equal(requests,4);
  } finally {
    await engine.flush();
    for(const [key,descriptor] of originals) if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});
