import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { projectionLayout } from '../modules/measurement/projectionLayout.ts';
const point=(i)=>({id:`p${i}`,coordinates:[103+i*.001,30],altitude:100+i*10,heightSource:'terrain'});

test('full projection retains every segment and missing heights without inventing ground',()=>{
  const short=projectionLayout([point(0),point(1),point(2)]);
  assert.equal(short.nodes.length,3);assert.equal(short.width,260);
  const long=projectionLayout(Array.from({length:200},(_,i)=>point(i)));
  assert.equal(long.nodes.length,200);assert.equal(long.segments.length,199);
  assert.ok(long.width>300);assert.ok(long.chainage[199]>long.chainage[198]);
  assert.ok(long.nodes.every((p,i)=>i===0||p.x>long.nodes[i-1].x));
  const missing=projectionLayout([point(0),{...point(1),altitude:null,heightSource:'unknown'},point(2)]);
  assert.ok(missing.segments.every(s=>s.rise===null));
});

test('projection labels every segment rise, including descent and zero, without fabricating missing heights',async()=>{
  await build({entryPoints:['modules/measurement/ProjectionChart.tsx'],outfile:'.openai/projection-rise.js',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
  const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
  const {ProjectionChart}=await import('../.openai/projection-rise.js');
  const {segmentMetrics}=await import('../modules/measurement/data.ts');
  const points=[point(0),{...point(1),altitude:128.7},{...point(2),altitude:100}, {...point(3),altitude:100}];
  const render=ps=>parseHTML(renderToStaticMarkup(React.createElement(ProjectionChart,{points:ps,metrics:segmentMetrics(ps[0],ps[1]),segment:0,total:300,saved:false,hint:null,reading:false,onRetry(){}}))).document;
  const doc=render(points);
  assert.deepEqual([...doc.querySelectorAll('[data-profile-rise]')].map(el=>el.textContent),['+28.7 m','-28.7 m','+0.0 m']);
  assert.match(doc.querySelector('[data-profile-rise="1"]').getAttribute('aria-label'),/B到C高差 -28.7米/);
  const missing=render([points[0],{...points[1],altitude:null,heightSource:'unknown'},points[2]]);
  assert.equal(missing.querySelectorAll('[data-profile-rise]').length,0);
  assert.match(missing.querySelector('figure').textContent,/部分海拔缺失/);
});

test('toolbar point picks replace that point repeatedly, existing marker snaps it, undo preserves identities',async(t)=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
  window.HTMLElement.prototype.scrollIntoView=()=>{};
  const disk=new Map([['shantu.measurement.path.v1',JSON.stringify({version:1,points:[point(0),point(1),point(2)]})]]);
  globalThis.localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)};
  await build({entryPoints:['modules/measurement/Measurement.tsx','modules/measurement/useMeasurement.ts'],outdir:'.openai/measurement-selection',bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',plugins:[{name:'terrain-stub',setup(b){b.onResolve({filter:/terrain\/elevation$/},()=>({path:'terrain',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const readElevation=async()=>123;'}));}}]});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const {Measurement}=await import('../.openai/measurement-selection/Measurement.js');
  const {useMeasurement}=await import('../.openai/measurement-selection/useMeasurement.js');
  let state;const watch=()=>()=>{};
  function Probe(){state=useMeasurement();return React.createElement(Measurement,{state,watchProjection:watch,projectGround:p=>({x:p.coordinates[0],y:p.coordinates[1]}),onBegin(){},toCoordinate:p=>[p.x,p.y],groundElevation:()=>200,elevationScale:1});}
  const root=createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());});
  await act(async()=>root.render(React.createElement(Probe)));
  await act(async()=>document.querySelector('[aria-label="选择测量点 A"]').click());
  assert.equal(state.slot,0);
  await act(async()=>state.add([104,31],210));await act(async()=>state.add([104.1,31.1],220));
  assert.equal(state.slot,0);assert.deepEqual(state.points[0].coordinates,[104.1,31.1]);assert.deepEqual(state.points[1],point(1));assert.equal(state.points.length,3);
  const b=document.querySelector('[aria-label="拖动测量点 B"]');
  b.setPointerCapture=()=>{};
  for(const type of ['pointerdown','pointerup']){
    const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:1,button:0,clientX:100,clientY:300});
    await act(async()=>b.dispatchEvent(event));
  }
  assert.deepEqual(state.points[0].coordinates,point(1).coordinates);assert.equal(state.points[0].id,'p0');
  await act(async()=>state.undo());assert.deepEqual(state.points[0].coordinates,[104.1,31.1]);
  await act(async()=>document.querySelector('[aria-label="选择测量点 C"]').click());
  await act(async()=>state.add([105,32],300));assert.equal(state.points[2].id,'p2');assert.equal(state.slot,2);
  assert.equal(document.querySelectorAll('[data-profile-point]').length,3);assert.equal(document.querySelectorAll('[data-segment]').length,2);
  assert.match(document.querySelector('figcaption').textContent,/A → C/);
});
