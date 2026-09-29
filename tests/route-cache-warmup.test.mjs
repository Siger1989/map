import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const entry=resolve('modules/outdoor/RouteCacheWarmup.ts');
const state=()=>globalThis.__routeWarmup;
const mocks={
  name:'warmup-dependencies',
  setup(build){
    build.onResolve({filter:/^\.\.\/mapSources\/RasterCoordinates$/},()=>({path:'mock:raster',namespace:'warmup'}));
    build.onResolve({filter:/^\.\/browseCacheRoute$/},()=>({path:'mock:route',namespace:'warmup'}));
    build.onResolve({filter:/^\.\/routeCachePolicy$/},()=>({path:'mock:policy',namespace:'warmup'}));
    build.onResolve({filter:/^\.\/browseCachePreferences$/},()=>({path:'mock:settings',namespace:'warmup'}));
    build.onResolve({filter:/^\.\/tileCache$/},()=>({path:'mock:offline',namespace:'warmup'}));
    build.onResolve({filter:/^\.\/offlineDownloadPolicy$/},()=>({path:'mock:download',namespace:'warmup'}));
    build.onLoad({filter:/.*/,namespace:'warmup'},args=>{
      const code={
        'mock:raster':`export const rasterTileUrl=(ts,z,x,y)=>ts[0].replace('{z}',z).replace('{x}',x).replace('{y}',y);`,
        'mock:route':`export const CACHE_ROUTE_CHANGED='route'; export function cacheRoutePoints(){return globalThis.__routeWarmup.points;}`,
        'mock:policy':`export function routeCacheTiles(){return globalThis.__routeWarmup.near?globalThis.__routeWarmup.tiles:[];}`,
        'mock:settings':`export const BROWSE_CACHE_CHANGED='settings'; export const BROWSE_CACHE_CLEARED='clear'; export function readBrowseCacheSettings(){return {enabled:globalThis.__routeWarmup.enabled,bufferKm:1};}`,
        'mock:offline':`export function offlineMapOnly(){return globalThis.__routeWarmup.offlineOnly;}`,
        'mock:download':`export function canDownloadTrip({urls=[]}={}){return !urls.some(u=>/tianditu\\.(gov\\.cn|com)/i.test(u));}`,
      }[args.path];
      return {contents:code,loader:'js'};
    });
  },
};
const bundled=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[mocks]});
const moduleUrl='data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64');
const {RouteCacheWarmup}=await import(moduleUrl);

class Events {
  handlers=new Map();
  addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(fn);}
  removeEventListener(name,fn){this.handlers.get(name)?.delete(fn);}
  dispatchEvent(event){for(const fn of [...(this.handlers.get(event.type)??[])])fn(event);return true;}
  emit(name){this.dispatchEvent(new Event(name));}
}
function setup({points=[[0,0],[.1,0]],tiles=[{z:10,x:512,y:512}],sourceUrl='https://tiles-{source}.test/{z}/{x}/{y}.png',fetchTileOverride}={}){
  const s=globalThis.__routeWarmup={points,tiles,near:true,enabled:true,offlineOnly:false,fetches:[],settingsEvents:0};
  let nextId=1;const timers=new Map();
  const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,realNow=Date.now;
  globalThis.setTimeout=(fn,delay=0)=>{const id=nextId++;timers.set(id,{fn,delay});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  Date.now=()=>1000;
  const win=new Events(),doc=new Events();doc.hidden=false;
  const nav={onLine:true,connection:Object.assign(new Events(),{saveData:false,effectiveType:'4g'})};
  Object.defineProperty(globalThis,'window',{configurable:true,value:win});
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:nav});
  const listeners=new Map();
  const map={
    isMoving:()=>false,areTilesLoaded:()=>true,getZoom:()=>10,getCenter:()=>({lng:0,lat:0}),
    on:(n,f)=>{if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},
    off:(n,f)=>listeners.get(n)?.delete(f),emit(n){for(const f of [...(listeners.get(n)??[])])f();},
    getStyle:()=>({layers:[{type:'raster',source:'s1'}]}),getTerrain:()=>undefined,
    getSource:id=>({tiles:[sourceUrl.replace('{source}',id)],minzoom:0,maxzoom:18,scheme:'xyz'}),
  };
  const fetchTile=fetchTileOverride??((url,signal,tile)=>{s.fetches.push({url,signal,tile});return Promise.resolve(new Response(new Uint8Array([1])));});
  const warmup=new RouteCacheWarmup(map,fetchTile,()=>({tiles:[sourceUrl]}));
  const runTimers=async()=>{
    const due=[...timers.entries()];timers.clear();
    for(const [,timer] of due)timer.fn();
    for(let i=0;i<100;i++)await Promise.resolve();
  };
  const restore=()=>{warmup.dispose();globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;Date.now=realNow;delete globalThis.window;delete globalThis.document;delete globalThis.navigator;delete globalThis.__routeWarmup;};
  return {s,win,doc,nav,map,warmup,timers,runTimers,restore};
}

test('warmup waits for a settled idle map and fetches route tiles only after its delay',async()=>{
  const h=setup();
  try{h.runTimers();assert.equal(h.s.fetches.length,0);h.map.emit('idle');assert.equal(h.s.fetches.length,0);await h.runTimers();assert.equal(h.s.fetches.length,1);assert.equal(h.s.fetches[0].tile.x,512);}
  finally{h.restore();}
});

test('far-only routes produce no background requests',async()=>{
  const h=setup();h.s.near=false;
  try{h.map.emit('idle');await h.runTimers();assert.equal(h.s.fetches.length,0);}
  finally{h.restore();}
});

test('moving, hidden, cleared, disabled, data-saver, and offline states cancel scheduled work',async t=>{
  const cases=[
    ['moving',h=>h.map.emit('movestart')],
    ['hidden',h=>{h.doc.hidden=true;h.doc.emit('visibilitychange');}],
    ['cleared',h=>h.win.emit('clear')],
    ['disabled',h=>{h.s.enabled=false;h.win.emit('settings');}],
    ['data saver',h=>{h.nav.connection.saveData=true;h.win.emit('settings');}],
    ['offline',h=>{h.nav.onLine=false;h.win.emit('offline');}],
  ];
  for(const [name,change] of cases)await t.test(name,async()=>{
    const h=setup();try{h.map.emit('idle');assert.equal(h.timers.size,1);change(h);if(['cleared','disabled'].includes(name))assert.equal(h.timers.size,0,`${name} should cancel pending timer; listeners=${[...h.win.handlers.keys()]}`);await h.runTimers();assert.equal(h.s.fetches.length,0);}finally{h.restore();}
  });
});

test('movement and disposal abort an active request',async t=>{
  for(const event of ['movestart','dispose','styledata','connection'])await t.test(event,async()=>{
    let resolveFetch;const h=setup({fetchTileOverride:(url,signal)=>{h.s.fetches.push({url,signal});return active;}});
    const active=new Promise(resolve=>{resolveFetch=resolve;});
    try{h.map.emit('idle');await h.runTimers();assert.equal(h.s.fetches.length,1);const signal=h.s.fetches[0].signal;if(event==='dispose')h.warmup.dispose();else if(event==='connection'){h.nav.connection.saveData=true;h.nav.connection.emit('change');}else h.map.emit(event);assert.equal(signal.aborted,true);resolveFetch(new Response(new Uint8Array()));await Promise.resolve();}
    finally{h.restore();}
  });
});

test('each warmup round is capped at 24 requests and TianDiTu sources are skipped',async()=>{
  const tiles=Array.from({length:48},(_,i)=>({z:10,x:512+i,y:512}));
  const h=setup({tiles});h.s.tiles=tiles;
  // Three distinct raster sources can contribute at most 36 candidates, with a round cap of 24.
  h.map.getStyle=()=>({layers:[{type:'raster',source:'s1'},{type:'raster',source:'s2'},{type:'raster',source:'s3'}]});
  try{h.map.emit('idle');await h.runTimers();assert.equal(h.s.fetches.length,24);}
  finally{h.restore();}
  const tdt=setup({sourceUrl:'https://t0.tianditu.gov.cn/img_w/{z}/{x}/{y}.png'});
  try{tdt.map.emit('idle');await tdt.runTimers();assert.equal(tdt.s.fetches.length,0);}
  finally{tdt.restore();}
});

