import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdir} from 'node:fs/promises';
await mkdir('.openai',{recursive:true});
await build({entryPoints:['modules/outdoor/offline.ts','modules/outdoor/offlineCoverage.ts'],outdir:'.openai/feedback54-check',bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},packages:'external',define:{'process.env.NEXT_PUBLIC_TIANDITU_KEY':'""'}});
const {removeTrip,tripPackages}=await import('../.openai/feedback54-check/offline.mjs');const {coverageGeometry}=await import('../.openai/feedback54-check/offlineCoverage.mjs');
const INDEX='guanyun.trips.v1';
function setup(){const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};globalThis.window={location:{origin:'https://app.test'}};return data;}
const trip=(id,urls)=>({id,name:id,urls,bounds:[100,30,101,31],done:urls.length,bytes:10,zoom:14,complete:true});
test('removal preserves shared tiles and concurrent progress in other packages',async()=>{
 const data=setup(),a=trip('a',['https://tile/shared','https://tile/a']),b=trip('b',['https://tile/shared']);data.set(INDEX,JSON.stringify([a,b]));let deleted=[];
 globalThis.caches={open:async()=>({delete:async url=>{deleted.push(url);data.set(INDEX,JSON.stringify([a,{...b,done:7}]));return true;}})};
 await removeTrip(a);assert.deepEqual(deleted,['https://tile/a']);assert.equal(tripPackages()[0].done,7);assert.equal(tripPackages()[0].id,'b');
});
test('partial native/browser delete failure is retryable and does not erase index early',async()=>{
 const data=setup(),a={...trip('a',['https://tile/a']),native:true};data.set(INDEX,JSON.stringify([a]));let nativeCalls=0,fail=true;
 window.GuanyunNative={offlineStart(){},offlineRemove(){nativeCalls++;return true;}};
 globalThis.caches={open:async()=>({delete:async()=>{if(fail)throw Error('disk');return true;}})};
 await assert.rejects(removeTrip(a),/disk/);assert.equal(tripPackages().length,1);fail=false;await removeTrip(a);assert.equal(tripPackages().length,0);assert.equal(nativeCalls,2);
});
test('coverage merges tile rows and marks incomplete package as outline only',()=>{
 const p=trip('x',['tdt:img:14:9000:5000','tdt:img:14:9001:5000','tdt:cia:14:9000:5000','tdt:img:14:9010:5010']);
 const c=coverageGeometry(p);assert.equal(c.filled,true);assert.equal(c.data.features.length,2);assert.match(c.label,/14级/);
 assert.equal(coverageGeometry({...p,complete:false}).filled,false);assert.match(coverageGeometry({...p,complete:false}).label,/未完成/);
});
