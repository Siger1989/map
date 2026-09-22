import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {parseHTML} from 'linkedom';
test('opening 14-level package caps only cache-only mode, restores online detail on mount and toggle',async()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 await build({entryPoints:['modules/outdoor/useOfflineMapMode.ts'],outfile:'.openai/feedback54-map-mode.mjs',bundle:true,platform:'node',format:'esm',packages:'external',define:{'process.env.NEXT_PUBLIC_TIANDITU_KEY':'""'}});
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{useOfflineMapMode}=await import('../.openai/feedback54-map-mode.mjs');
 let open,state={offlineMaxZoom:14,rasterLevel:16};function Probe(){open=useOfflineMapMode(p=>Object.assign(state,p),()=>{});return null;}
 const root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(React.createElement(Probe)));assert.equal(state.offlineMaxZoom,null);assert.equal(state.rasterLevel,16);
 const trip={id:'p',zoom:14,display:{offlineMaxZoom:14,rasterLevel:null}};values.set('guanyun.trips.v1',JSON.stringify([trip]));open(trip);assert.equal(state.offlineMaxZoom,null);
 values.set('shantu.offline-map-only.v1','true');window.dispatchEvent(new window.Event('shantu:offline-map-mode'));assert.equal(state.offlineMaxZoom,14);
 values.set('shantu.offline-map-only.v1','false');window.dispatchEvent(new window.Event('shantu:offline-map-mode'));assert.equal(state.offlineMaxZoom,null);await React.act(async()=>root.unmount());
});
