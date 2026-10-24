import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {parseHTML} from 'linkedom';
test('offline mode requires a valid selected package and restores its zoom cap and source',async()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const values=new Map([['shantu.offline-map-only.v1','true']]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 await build({entryPoints:['modules/outdoor/useOfflineMapMode.ts'],outfile:'.openai/feedback54-map-mode.mjs',bundle:true,platform:'node',format:'esm',packages:'external',define:{'process.env.NEXT_PUBLIC_TIANDITU_KEY':'""'}});
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{useOfflineMapMode}=await import('../.openai/feedback54-map-mode.mjs');
 let open,selected='',state={offlineMaxZoom:14,rasterLevel:16};function Probe(){open=useOfflineMapMode(p=>Object.assign(state,p),id=>{selected=id});return null;}
 const root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(React.createElement(Probe)));assert.equal(state.offlineMaxZoom,null);assert.equal(state.rasterLevel,16);assert.equal(values.get('shantu.offline-map-only.v1'),'false','stale cache-only preference is cleared when no valid package is selected');
 const trip={id:'p',zoom:14,display:{offlineMaxZoom:14,rasterLevel:null}};values.set('guanyun.trips.v1',JSON.stringify([trip]));open(trip);assert.equal(state.offlineMaxZoom,14);
 window.dispatchEvent(new window.Event('shantu:offline-map-mode'));assert.equal(state.offlineMaxZoom,14);
 values.set('shantu.map-source-coordinates.v1',JSON.stringify({'custom:other':'bd09'}));
 const imported={id:'imported',provider:'imported',sourceId:'s19',datum:'gcj02',zoom:19,display:{terrain:true,offlineBasemap:true,rasterDatums:{'custom:s19':'wgs84'}}};
 open(imported);assert.equal(selected,'s19');assert.equal(state.offlineMaxZoom,19);assert.equal(state.terrain,false);assert.equal(state.offlineBasemap,false);assert.equal(state.rasterLevel,null);
 assert.deepEqual(state.rasterDatums,{'custom:other':'bd09','custom:s19':'gcj02'});
 const storage=globalThis.localStorage;globalThis.localStorage={getItem:()=>null,setItem(){throw Error('quota')},removeItem(){}};
 assert.throws(()=>open(trip),/缓存包选择未能保存/);assert.equal(selected,'s19');assert.equal(state.offlineMaxZoom,19,'storage failure does not switch the active map');globalThis.localStorage=storage;
  open(trip);assert.equal(selected,'');assert.equal(state.offlineMaxZoom,14);
 await React.act(async()=>root.unmount());
});
