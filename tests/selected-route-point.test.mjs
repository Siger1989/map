import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('map selection moves the profile cursor and shows grade, elevation and recorded speed, including reverse and missing data',async(t)=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  await build({entryPoints:['modules/routeDisplay/SelectedRouteInfo.tsx'],outfile:'.openai/selected-route-point.mjs',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',plugins:[{name:'host-hooks',setup(b){b.onResolve({filter:/\/(useTrackElevation|useDockClearance)$/},a=>({path:a.path.split('/').at(-1),namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='useTrackElevation'?'export const useTrackElevation=track=>({profile:track});':'export const useDockClearance=()=>null;'}));}}]});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const {SelectedRouteInfo}=await import('../.openai/selected-route-point.mjs');
  const root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());});
  const track={id:'route',name:'实走',createdAt:1,source:'recorded',segments:[[[0,0],[.001,0],[.002,0]]],samples:[[{altitude:100,time:100000},{altitude:120,time:160000},{altitude:110,time:220000}]]};
  const preferences={profile:true,statistics:true,legend:true,mode:'slope'};
  const render=(point,extra={})=>act(async()=>root.render(React.createElement(SelectedRouteInfo,{track,preferences,point,...extra})));
  const point=x=>({trackId:track.id,coordinate:[x,0],distance:0});
  const cursor=()=>document.querySelector('[aria-label="所选路线点"] circle');
  const info=()=>document.querySelector('[aria-label="剖面所选点信息"]')?.textContent;
  await render(point(.0005));const first=Number(cursor().getAttribute('cx'));
  assert.match(info(),/56 米/);assert.match(info(),/110m/);assert.match(info(),/路段坡度 \+10\.2°/);assert.match(info(),/速度 6\.7 km\/h/);
  await render(point(.0015));assert.ok(Number(cursor().getAttribute('cx'))>first);assert.match(info(),/路段坡度 -5\.1°/);
  await render(point(.0005),{reversed:true});assert.ok(Number(cursor().getAttribute('cx'))>first);assert.match(info(),/167 米/);assert.match(info(),/路段坡度 -10\.2°/);
  await render(point(.0005),{track:{...track,samples:undefined,source:'manual'}});assert.ok(document.querySelector('[aria-label="所选路线点，高程缺失"]'));assert.match(info(),/海拔 —/);assert.doesNotMatch(info(),/速度/);
  await render({...point(.001),trackId:'other'});assert.equal(cursor(),null);assert.equal(info(),undefined);
});
