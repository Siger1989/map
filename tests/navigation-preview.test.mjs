import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { mkdir } from 'node:fs/promises';

test('mode changes preview real road results, stale results cannot start, original remains available on failure',async()=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  await mkdir('.openai',{recursive:true});
  await build({entryPoints:['modules/guidance/NavigationStart.tsx'],outfile:'.openai/navigation-preview-check.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'preview-fixtures',setup(b){
    b.onResolve({filter:/navigation\/provider$/},()=>({path:'planner',namespace:'test'}));
    b.onResolve({filter:/(RouteViews|RouteMiniMap|RouteElevationSummary|useRouteDialogFocus)$/},a=>({path:a.path.split('/').at(-1),namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},a=>({resolveDir:process.cwd(),contents: a.path==='planner' ? `export const planRoute=(...args)=>globalThis.previewPlanner(...args);` : a.path==='RouteViews' ? `import React from 'react';export const RouteBack=({onBack})=>React.createElement('button',{onClick:onBack},'返回');` : a.path==='RouteMiniMap' ? `import React from 'react';export const RouteMiniMap=({coordinates})=>React.createElement('output',{'data-preview':true},JSON.stringify(coordinates));` : a.path==='useRouteDialogFocus' ? `export const useRouteDialogFocus=()=>null;` : `export const RouteElevationSummary=()=>null;` }));
  }}]});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const {NavigationStart}=await import('../.openai/navigation-preview-check.mjs');
  const {trackNavigation}=await import('../modules/guidance/savedRoute.ts');
  const track={id:'original',name:'原始手绘',createdAt:1,segments:[[[103,30],[103.001,30.003],[103.005,30.006]]]};
  const target=trackNavigation(track,1);const original=JSON.stringify(target);
  let requests=[],started=[];globalThis.previewPlanner=(start,end,mode,signal)=>new Promise((resolve,reject)=>requests.push({start,end,mode,signal,resolve,reject}));
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(NavigationStart,{target,onStart:t=>started.push(t),onClose(){}})));
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  assert.equal(button('沿原路线开始导航').disabled,false);
  await act(async()=>button('骑行').click());assert.equal(requests.at(-1).mode,'bicycle');assert.equal(document.querySelector('footer button').disabled,true);
  await act(async()=>button('驾车').click());assert.equal(requests[0].signal.aborted,true);
  const route={...target.route,geometryKind:'road',mode:'auto',coordinates:[[103,30],[103.003,30.001],[103.005,30.006]],distance:1000};
  await act(async()=>requests[0].resolve({...route,mode:'bicycle'}));assert.equal(document.querySelector('[data-preview]'),null);
  await act(async()=>requests[1].resolve(route));assert.equal(document.querySelector('[data-preview]').textContent,JSON.stringify(route.coordinates));
  await act(async()=>button('使用新规划开始导航').click());assert.deepEqual(started[0].route.coordinates,route.coordinates);
  await act(async()=>button('步行').click());await act(async()=>requests.at(-1).reject(Error('规划服务不可用')));
  assert.equal(document.querySelector('footer button').disabled,true);
  await act(async()=>button('沿原路线').click());assert.equal(button('沿原路线开始导航').disabled,false);
  await act(async()=>button('沿原路线开始导航').click());assert.equal(started.at(-1).route.geometryKind,'track');
  assert.equal(JSON.stringify(target),original);await act(async()=>root.unmount());delete globalThis.previewPlanner;
});
