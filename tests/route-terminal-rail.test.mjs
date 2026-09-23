import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('journey rail does not invent a branch end and opens the manually chosen branch vertex', async (t) => {
  const {window} = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, {window, document:window.document, IS_REACT_ACT_ENVIRONMENT:true});
  await build({entryPoints:['modules/tracks/TrackJourneyRail.tsx'],outfile:'.openai/route-terminal-rail.mjs',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
  const React=await import('react'), {act}=React, {createRoot}=await import('react-dom/client');
  const {TrackJourneyRail}=await import('../.openai/route-terminal-rail.mjs');
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());});
  const a=[104,30],b=[104.001,30],c=[104.002,30],d=[104.001,30.001];
  const track={id:'branch',name:'分叉',segments:[[a,b,c],[b,d]]};
  let point=null;
  const render=(value,extra={})=>act(async()=>root.render(React.createElement(TrackJourneyRail,{
    track:value,markers:[],selected:null,onPoint:p=>{point=p;},onMarker:()=>{},
    activeAlternative:'main',onAlternative:()=>{},homeOverview:true,onReverse:()=>{},...extra,
  })));
  await render(track);
  let end=document.querySelector('.home-journey-end');
  assert.equal(end.disabled,true);
  assert.match(end.textContent,/终点未指定/);
  assert.equal(document.querySelector('[aria-label="切换路线方向"]').disabled,true);

  await render({...track,routeTerminals:{start:a,end:d}});
  end=document.querySelector('.home-journey-end');
  assert.equal(end.disabled,false);
  assert.match(end.textContent,/终点.*已指定/);
  await act(async()=>end.click());
  assert.deepEqual(point.coordinate,d);
  assert.notDeepEqual(point.coordinate,c);
  assert.ok(point.sourceDistance > 0);

  await render({...track,routeTerminals:{start:a,end:d}},{reversed:true});
  await act(async()=>document.querySelector('.home-journey-end').click());
  assert.deepEqual(point.coordinate,a);

  await render(track,{homeOverview:false});
  assert.match(document.querySelector('.track-journey-rail .rail-end').textContent,/终点未指定/);
  await render({id:'plain',name:'旧单线',segments:[[a,b,c]]});
  assert.equal(document.querySelector('.home-journey-end').disabled,false);
});
