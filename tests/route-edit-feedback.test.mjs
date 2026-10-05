import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { RouteGapLayer } from '../modules/tracks/RouteGapLayer.ts';
import { composeTrackOverlay } from '../modules/workbench/trackOverlay.ts';
import { startRouteEdit, selectEditNode, setEditEnd, toggleEditBranch, undoRouteEdit, renameEditRoute } from '../modules/tracks/routeEdit.ts';

const bundle = await build({stdin:{contents:`export {useRouteDisplay} from './modules/routeDisplay/useRouteDisplay'; export {RouteEditToolbar} from './modules/tracks/RouteViews'; export {TrackLayer} from './modules/tracks/TrackLayer';`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'},write:false,logLevel:'silent'});
await writeFile('.openai/route-edit-feedback-bundle.mjs',bundle.outputFiles[0].text);
const {useRouteDisplay,RouteEditToolbar,TrackLayer}=await import('../.openai/route-edit-feedback-bundle.mjs');
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const style={color:'#ff4400',width:3};
function dom(){ const {window}=parseHTML('<html><body><div id="root"></div></body></html>'); Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true}); globalThis.localStorage={getItem:()=>JSON.stringify({mode:'slope'}),setItem(){}}; return window; }
function mapMock(){
  const sources=new Map(),layers=new Map(),stats={writes:0,projects:0,updates:0};
  return {sources,stats,on(){},getSource:id=>sources.get(id),getLayer:id=>layers.get(id),
    addSource(id,spec){sources.set(id,{data:structuredClone(spec.data),setData(data){this.data=structuredClone(data);if(id==='manual-tracks')stats.writes++;return Promise.resolve();},updateData(diff){if(id==='manual-tracks')stats.updates++;for(const change of diff.update??[]){const feature=this.data.features.find(f=>f.id===change.id);if(feature)for(const {key,value} of change.addOrUpdateProperties??[])feature.properties[key]=value;}return Promise.resolve();}});},
    addLayer(spec){layers.set(spec.id,spec);},getStyle:()=>({layers:[...layers.values()]}),moveLayer(){},isMoving:()=>false,
    project:([x,y])=>{stats.projects++;return {x:x*1e5,y:y*1e5};}};
}

test('editing clears both DOM and geographic gap cues, blocks stale redisplay, exit stays clear',()=>{
  dom();const map=mapMock(),container=document.createElement('div');document.body.append(container);
  Object.assign(map,{getContainer:()=>container,getCenter:()=>({lng:0,lat:0}),getZoom:()=>10});
  const gap={from:[0,0],to:[.001,0],distance:111},layer=new RouteGapLayer(map);
  layer.sync(gap);assert.ok(document.querySelector('[data-route-gap]'));
  layer.setEditing(true);assert.equal(document.querySelector('[data-route-gap]'),null);
  assert.equal(map.sources.get('route-gap').data.features.length,0);
  layer.sync(gap);assert.equal(document.querySelector('[data-route-gap]'),null);
  assert.equal(map.sources.get('route-gap').data.features.length,0);
  layer.setEditing(false);assert.equal(document.querySelector('[data-route-gap]'),null);
  layer.sync(gap);assert.ok(document.querySelector('[data-route-gap]'),'explicit browse inspection can be shown again');
  layer.sync(null);
});

test('main toolbar exposes setting one branch node as end with real undo and no subpage detour',async t=>{
  dom();const a=[20,10],b=[20.01,10],c=[20.02,10],d=[20.01,10.01];
  let session=startRouteEdit({id:'fork',name:'fork',createdAt:0,style,segments:[[a,b,c],[b,d]]}),select,rerender;
  function Probe(){const [value,setValue]=React.useState(session),[points,setPoints]=React.useState([]);session=value;
    select=p=>{setPoints(p?[p]:[]);setValue(v=>p?selectEditNode(v,p):{...v,selected:null});};rerender=setValue;
    return React.createElement(RouteEditToolbar,{session:value,selectedPoints:points,error:'',boxMode:null,onName:name=>setValue(v=>renameEditRoute(v,name)),onSetEnd:()=>setValue(v=>setEditEnd(v,points[0])),onBranch:()=>setValue(toggleEditBranch),onUndo:()=>setValue(undoRouteEdit),onBack(){},onSave(){},onAdd(){},onRemove(){},onSelectionMode(){},onSelectionDetails(){},onPointMarker(){return true;},onClearSelection(){select(null);},onStyle(){},onSnapping(){},onRoadSnapping(){},onRiverSnapping(){},snapping:false,roadSnapping:false,riverSnapping:false});}
  const root=createRoot(document.getElementById('root'));t.after(async()=>act(async()=>root.unmount()));
  await act(async()=>root.render(React.createElement(Probe)));
  const button=()=>document.querySelector('.route-selection-modes .route-set-endpoint');
  assert.equal(button().disabled,true);
  await act(async()=>select(d));assert.equal(button().disabled,false);
  await act(async()=>button().click());assert.deepEqual(session.track.routeTerminals.end,d);assert.equal(button().getAttribute('aria-pressed'),'true');
  await act(async()=>rerender(undoRouteEdit));assert.equal(session.track.routeTerminals?.end,undefined);assert.deepEqual(session.track.routeTerminals.start,a);
  await act(async()=>rerender(toggleEditBranch));assert.equal(button().disabled,true,'unfinished branch does not mark its fixed anchor as destination');
  await act(async()=>rerender(toggleEditBranch));assert.equal(button().disabled,false);
  assert.equal(document.querySelector('.route-edit-dock').dataset.view,'tools');
});

test('route editor title is an IME-safe rename field and save receives the latest unblurred value',async t=>{
  dom();
  const original={id:'rename-route',name:'原路线',createdAt:0,source:'manual',style,segments:[[[20,10],[20.01,10]]]};
  let session=startRouteEdit(original),setSession,saved,backed;
  function Probe(){const [value,update]=React.useState(session);session=value;setSession=update;
    return React.createElement(RouteEditToolbar,{session:value,selectedPoints:[],error:'',boxMode:null,
      onName:name=>update(v=>renameEditRoute(v,name)),onBack:name=>{backed=name;},onSave:name=>{saved=name;},
      onAdd(){},onRemove(){},onSelectionMode(){},onSelectionDetails(){},onPointMarker(){return true;},onSetEnd(){},onClearSelection(){},onBranch(){},onUndo(){update(undoRouteEdit);},onStyle(){},onSnapping(){},onRoadSnapping(){},onRiverSnapping(){},snapping:false,roadSnapping:false,riverSnapping:false});}
  const root=createRoot(document.getElementById('root'));t.after(async()=>act(async()=>root.unmount()));
  await act(async()=>root.render(React.createElement(Probe)));
  let input=document.querySelector('.route-edit-name-input');
  assert.ok(input);
  assert.equal(input.getAttribute('aria-label'),'路线名称');
  assert.equal(input.value,'原路线');
  assert.equal(document.querySelector('.route-edit-dock-heading strong'),null,'the old static title is replaced');
  const changeText=async value=>{
    const propsKey=Object.keys(input).find(key=>key.startsWith('__reactProps$'));
    const handler=propsKey&&input[propsKey]?.onChange;
    assert.ok(handler,'React input handler is installed');
    await act(async()=>handler({target:{value},currentTarget:{value}}));
  };
  await changeText('正在组词');
  let inputProps= input[Object.keys(input).find(key=>key.startsWith('__reactProps$'))];
  await act(async()=>inputProps.onCompositionStart());
  let enterPrevented=false,blurred=false;
  await act(async()=>inputProps.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){enterPrevented=true;},currentTarget:{blur(){blurred=true;}}}));
  assert.equal(enterPrevented,false,'Enter commits the active Chinese composition instead of submitting early');
  assert.equal(blurred,false);
  assert.equal(session.track.name,'原路线');
  await act(async()=>inputProps.onCompositionEnd({currentTarget:{value:'  新路线  '}}));
  input=document.querySelector('.route-edit-name-input');
  inputProps=input[Object.keys(input).find(key=>key.startsWith('__reactProps$'))];
  await act(async()=>inputProps.onBlur());
  assert.equal(session.track.name,'新路线');
  assert.equal(session.history.length,1);
  assert.equal(original.name,'原路线');
  await act(async()=>setSession(undoRouteEdit));
  input=document.querySelector('.route-edit-name-input');
  assert.equal(input.value,'原路线','undo restores the title field');
  await changeText('最终名称');
  await act(async()=>document.querySelector('.route-edit-heading-actions .route-solid').click());
  assert.equal(saved,'最终名称','save gets the current buffer even if change/blur state has not rerendered');
  assert.equal(session.track.name,'最终名称');
  await changeText('临时名称');
  input=document.querySelector('.route-edit-name-input');
  inputProps=input[Object.keys(input).find(key=>key.startsWith('__reactProps$'))];
  let escaped=false,stopped=false;
  await act(async()=>inputProps.onKeyDown({key:'Escape',nativeEvent:{isComposing:false},preventDefault(){escaped=true;},stopPropagation(){stopped=true;}}));
  assert.equal(escaped,true);
  assert.equal(stopped,true,'Escape in the input does not escape the editor');
  assert.equal(document.querySelector('.route-edit-name-input').value,'最终名称');
  await changeText('   ');
  await act(async()=>document.querySelector('.route-edit-heading-actions button:not(.route-solid)').click());
  assert.equal(backed,'最终名称','blank input cannot erase the last committed name');
  assert.equal(session.track.name,'最终名称');
});

test('real slope display hook and map layer reuse geometry while repeatedly changing selected nodes',async t=>{
  dom();const points=Array.from({length:1000},(_,i)=>[20+i*.00001,10]);
  const track={id:'dense',name:'dense',createdAt:0,style,nodes:points,segments:[points],samples:[points.map((_,i)=>({altitude:100+i,time:null}))]};
  let session=startRouteEdit(track),select,output;
  const map=mapMock(),layer=new TrackLayer(map),base={saved:[track],draft:[],visible:true,style,nodes:[],selectedId:track.id,snapTargets:false};
  function Probe(){const [value,setValue]=React.useState(session);select=i=>setValue(v=>selectEditNode(v,points[i]));
    const overlay=React.useMemo(()=>composeTrackOverlay({...base,session:value,recording:null,nodeSelection:{trackId:track.id,points:value.selected?[value.selected]:[]}}),[value]);
    output=useRouteDisplay(overlay,{start:null,end:null,route:null,via:[]},track.id,true).tracks;
    React.useEffect(()=>layer.sync(output),[output]);return null;}
  const root=createRoot(document.getElementById('root'));t.after(async()=>act(async()=>root.unmount()));
  await act(async()=>root.render(React.createElement(Probe)));
  const parts=output.analysisParts,shown=output.saved[0],writes=map.stats.writes,projects=map.stats.projects;
  assert.ok(parts);assert.equal(shown.style.colorMode,'slope');
  for(let i=1;i<21;i++)await act(async()=>select(i));
  assert.equal(output.analysisParts,parts);assert.equal(output.saved[0],shown);
  assert.equal(map.stats.writes,writes,'selection never rewrites the full route source');
  assert.equal(map.stats.projects,projects,'selection never reprojects all route handles');
  assert.ok(map.stats.updates>=20);
});
