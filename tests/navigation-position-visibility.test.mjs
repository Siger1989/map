import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Compile the real display layer without intercepting its state/geometry logic.
test('navigation only hides a start badge near the real marker and restores it on leave/stop', async () => {
  await build({entryPoints:['modules/navigation/RouteLayer.ts'],outfile:'.openai/nav-close-20261013/RouteLayer-test.mjs',bundle:true,format:'esm',platform:'node',packages:'external'});
  const {RouteLayer}=await import('../.openai/nav-close-20261013/RouteLayer-test.mjs');
  const sources=new Map(), layers=[];
  const map={getSource:id=>sources.get(id),addSource(id){sources.set(id,{setData(data){this.data=data}})},
    getLayer:id=>layers.find(l=>l.id===id),addLayer:l=>layers.push(l),getStyle:()=>({layers}),
    moveLayer(id){const i=layers.findIndex(l=>l.id===id);layers.push(...layers.splice(i,1))},on(){},off(){},
    getContainer:()=>({querySelectorAll:()=>[],getBoundingClientRect:()=>({left:0,top:0,width:390,height:857}),addEventListener(){},removeEventListener(){}}),
    getCanvas:()=>({clientWidth:390,clientHeight:857,getBoundingClientRect:()=>({left:0,top:0,width:390,height:857})}),getPitch:()=>0,getTerrain:()=>null,getProjection:()=>({type:'mercator'}),isStyleLoaded:()=>true,queryRenderedFeatures:()=>[],getLayoutProperty:()=> 'visible',getPaintProperty:()=>null};
  const start=[104,30],end=[104,30.01], geometry=[start,end];
  const state={start:{coordinates:start,name:'当前位置'},end:{coordinates:end,name:'终点'},route:{coordinates:geometry}};
  const layer=new RouteLayer(map);layer.sync(state);
  const data=()=>sources.get('planned-route').data;
  const starts=()=>data().features.filter(f=>f.properties.slot==='start');
  assert.equal(starts().length,1);
  layer.setNavigationPosition([104,30.00008]);assert.equal(starts().length,0);
  assert.deepEqual(data().features.find(f=>f.geometry.type==='LineString').geometry.coordinates,geometry);
  assert.equal(data().features.filter(f=>f.properties.slot==='end').length,1);
  layer.setNavigationPosition([104,30.001]);assert.equal(starts().length,1);
  layer.setNavigationPosition(start);assert.equal(starts().length,0);
  layer.setNavigationPosition(null);assert.equal(starts().length,1);
  assert.equal(state.start.name,'当前位置');
});
