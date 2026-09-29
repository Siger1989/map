import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const entries=[resolve('modules/outdoor/browseCacheRoute.ts'),resolve('modules/outdoor/useBrowseCacheRoute.ts')];
const plugin={
  name:'browse-cache-route-mocks',
  setup(build){
    for(const [specifier,id] of [
      ['./browseCache.ts','cache'],['./browseCachePreferences.ts','settings'],
      ['../tracks/drawing.ts','tracks'],['react','react'],
    ])build.onResolve({filter:new RegExp('^'+specifier.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')+'$')},()=>({path:id,namespace:'route-test'}));
    build.onLoad({filter:/.*/,namespace:'route-test'},args=>({loader:'js',contents:{
      cache:`
        const s=()=>globalThis.__browseRouteTest;
        export function setBrowseCachePriority(fn){s().priority=fn;}
        export function setBrowseCacheWritePolicy(fn){s().writePolicy=fn;}
        export function pruneBrowseCache(fn){
          s().pruneCalls.push(fn);
          const run=()=>{s().entries=s().entries.filter(row=>!fn(row.tile));};
          if(s().delayPrune)return new Promise(resolve=>s().pending.push(()=>{run();resolve();}));
          run();return Promise.resolve();
        }
      `,
      settings:`
        export const BROWSE_CACHE_CHANGED='settings';
        export function readBrowseCacheSettings(){const s=globalThis.__browseRouteTest;if(s.parseError)throw Error('storage unavailable');return {enabled:s.enabled,bufferKm:s.bufferKm};}
      `,
      tracks:`
        export const TRACK_STORAGE='saved-routes';
        export function parseSavedTracks(raw){if(raw===null)return [];const v=JSON.parse(raw);if(!Array.isArray(v))throw Error('invalid');return v;}
      `,
      react:`
        export function useEffect(fn,deps){globalThis.__browseRouteTest.effects.push(fn);}
        export function useRef(initial){const s=globalThis.__browseRouteTest;const i=s.refCursor++;return s.refs[i]??(s.refs[i]={current:initial});}
      `,
    }[args.path]}));
  },
};
const bundled=await build({entryPoints:entries,outdir:'bundle',bundle:true,write:false,format:'esm',platform:'node',plugins:[plugin]});
const bundleUrls=bundled.outputFiles.map(file=>'data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'));
let instance=0;
function state(extra={}){return {enabled:true,bufferKm:1,priority:()=>false,writePolicy:()=>false,entries:[],pruneCalls:[],pending:[],delayPrune:false,effects:[],refs:[],refCursor:0,parseError:false,...extra};}
async function load(s){globalThis.__browseRouteTest=s;Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent(){},addEventListener(){},removeEventListener(){}}});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>key==='saved-routes'?s.savedRaw??null:null}});const id=instance++;return {route:await import(`${bundleUrls[0]}#${id}`),hook:await import(`${bundleUrls[1]}#${id}`)};}
const track=(id,segments)=>({id,name:id,segments,createdAt:1});
const tile=(lon,lat,z=16)=>({z,x:Math.floor((lon+180)/360*2**z),y:Math.floor((1-Math.asinh(Math.tan(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180))/Math.PI)/2*2**z)});
async function flushPrunes(s){for(const complete of s.pending.splice(0))complete();await Promise.resolve();}

test('without saved or draft routes, writes deny known and unknown tiles',async()=>{
  const s=state(),m=await load(s);m.route.syncBrowseCacheRoutes([],[]);
  assert.equal(s.writePolicy(tile(0,0)),false);
  assert.equal(s.writePolicy(undefined),false);
  assert.equal(s.priority(tile(0,0)),false);
  assert.equal(s.pruneCalls.length,0);
});

test('all saved routes and draft define one passive corridor regardless of selection',async()=>{
  const s=state(),m=await load(s);
  const a=track('a',[[[-2,0],[0,0]]]),b=track('b',[[[2,0],[4,0]]]);
  m.route.syncBrowseCacheRoutes([a,b],[[[8,0],[9,0]]]);
  assert.equal(s.writePolicy(tile(-1,0)),true);
  assert.equal(s.writePolicy(tile(3,0)),true);
  assert.equal(s.writePolicy(tile(8.5,0)),true);
  assert.equal(s.writePolicy(tile(6,0)),false);
  assert.equal(s.writePolicy(undefined),false);
  assert.equal(s.priority(tile(-1,0)),true);
});

test('gaps between route parts never become a connecting cache corridor',async()=>{
  const s=state(),m=await load(s);
  m.route.syncBrowseCacheRoutes([track('gaps',[[[-4,0],[-3,0]],[[3,0],[4,0]]])],[]);
  assert.equal(s.writePolicy(tile(0,0)),false);
  assert.equal(s.writePolicy(tile(-3.5,0)),true);
  assert.equal(s.writePolicy(tile(3.5,0)),true);
});

test('deleting the last route prunes its known corridor but preserves unknown metadata',async()=>{
  const s=state(),m=await load(s),a=track('a',[[[0,0],[2,0]]]);
  const inside=tile(1,0),far=tile(20,0);
  s.entries=[{tile:inside},{tile:far},{tile:undefined}];
  m.route.syncBrowseCacheRoutes([a],[]);m.route.syncBrowseCacheRoutes([],[]);
  await flushPrunes(s);
  assert.deepEqual(s.entries.map(row=>row.tile),[far,undefined]);
});

test('deleting one of overlapping routes removes only its exclusive corridor',async()=>{
  const s=state(),m=await load(s);
  const horizontal=track('h',[[[0,0],[2,0]]]),vertical=track('v',[[[1,-1],[1,1]]]);
  const exclusive=tile(.5,0),overlap=tile(1,0);
  s.entries=[{tile:exclusive},{tile:overlap}];
  m.route.syncBrowseCacheRoutes([horizontal,vertical],[]);
  m.route.syncBrowseCacheRoutes([vertical],[]);
  await flushPrunes(s);
  assert.deepEqual(s.entries.map(row=>row.tile),[overlap]);
});

test('draft discard prunes exclusive tiles; saving the draft onto a route transfers protection',async t=>{
  await t.test('discard',async()=>{
    const s=state(),m=await load(s),draft=[[[0,0],[1,0]]];
    s.entries=[{tile:tile(.5,0)}];m.route.syncBrowseCacheRoutes([],draft);m.route.syncBrowseCacheRoutes([],[]);await flushPrunes(s);
    assert.equal(s.entries.length,0);
  });
  await t.test('save transfer',async()=>{
    const s=state(),m=await load(s),draft=[[[0,0],[1,0]]];
    s.entries=[{tile:tile(.5,0)}];m.route.syncBrowseCacheRoutes([],draft);m.route.syncBrowseCacheRoutes([track('saved',draft)],[]);await flushPrunes(s);
    assert.equal(s.entries.length,1);assert.equal(s.pruneCalls.length,1);
  });
});

test('deletion uses the maximum previously selectable width and preserves a new route added before pruning',async t=>{
  await t.test('previous 2km width is cleaned after setting narrows',async()=>{
    const s=state({bufferKm:2}),m=await load(s),a=track('a',[[[0,0],[1,0]]]),cached=tile(.5,.0135,17);
    s.entries=[{tile:cached}];m.route.syncBrowseCacheRoutes([a],[]);s.bufferKm=.5;m.route.syncBrowseCacheRoutes([],[]);await flushPrunes(s);
    assert.equal(s.entries.length,0);
  });
  await t.test('latest retention geometry protects delayed prune',async()=>{
    const s=state({delayPrune:true}),m=await load(s),a=track('a',[[[0,0],[2,0]]]),b=track('b',[[[0,0],[2,0]]]);
    const overlap=tile(1,0);s.entries=[{tile:overlap}];m.route.syncBrowseCacheRoutes([a],[]);m.route.syncBrowseCacheRoutes([],[]);m.route.syncBrowseCacheRoutes([b],[]);
    await flushPrunes(s);assert.equal(s.entries.length,1);
  });
});

test('initial hook hydration uses persisted saved tracks and storage errors never prune',async t=>{
  await t.test('initial empty state hydrates all persisted routes',async()=>{
    const saved=[track('a',[[[0,0],[1,0]]]),track('b',[[[8,0],[9,0]]])];
    const s=state({savedRaw:JSON.stringify(saved)}),m=await load(s);
    m.hook.useBrowseCacheRoute([],[]);for(const effect of s.effects)effect();
    assert.equal(s.writePolicy(tile(.5,0)),true);assert.equal(s.writePolicy(tile(8.5,0)),true);assert.equal(s.pruneCalls.length,0);
  });
  await t.test('archive parse failure does not interpret saved state as deletion',async()=>{
    const s=state({parseError:true}),m=await load(s);
    m.route.syncBrowseCacheRoutes([track('a',[[[0,0],[1,0]]])],[]);
    s.entries=[{tile:tile(.5,0)}];s.effects=[];s.refs=[];s.refCursor=0;
    m.hook.useBrowseCacheRoute([],[]);for(const effect of s.effects)effect();
    assert.equal(s.entries.length,1);assert.equal(s.pruneCalls.length,0);assert.equal(s.writePolicy(tile(.5,0)),false);
  });
});

test('passive writes stop when automatic caching is disabled after route synchronization',async()=>{
  const s=state(),m=await load(s);m.route.syncBrowseCacheRoutes([track('a',[[[0,0],[1,0]]])],[]);
  const inside=tile(.5,0);assert.equal(s.writePolicy(inside),true);
  s.enabled=false;assert.equal(s.writePolicy(inside),false);
});
