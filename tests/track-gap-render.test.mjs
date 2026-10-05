import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { trackNavigation } from '../modules/guidance/savedRoute.ts';
const bundle=await build({entryPoints:['modules/navigation/RouteLayer.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {RouteLayer}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('colored navigation never paints a solid line over a missing piece, and all line features preserve transparency',()=>{
 const sources=new Map(),layers=new Map();
 const map={getSource:id=>sources.get(id),getLayer:id=>layers.get(id),getStyle:()=>({layers:[...layers.values()]}),moveLayer(){},addSource(id){sources.set(id,{setData(data){this.data=data;}});},addLayer(layer){layers.set(layer.id,layer);}};
 const A=[20,10],B=[20.001,10],C=[20.003,10],D=[20.004,10];
 const f=trackNavigation({id:'t',name:'t',createdAt:1,segments:[[A,B],[C,D]],style:{colorMode:'elevation',opacity:0.37}},1,'pedestrian',[],'main',false,true);
 new RouteLayer(map).sync({...f,displayParts:[{coordinates:[A,B],color:'#f00'},{coordinates:[C,D],color:'#00f'}]});
 const features=sources.get('planned-route').data.features.filter(f=>f.geometry.type==='LineString');
 assert.equal(features.length,3);assert.ok(features.every(f=>f.properties.opacity===0.37));
 assert.deepEqual(features.find(f=>f.properties.kind==='access').geometry.coordinates,[B,C]);
 assert.ok(features.filter(f=>f.properties.kind==='road').every(f=>f.properties.color));
 assert.deepEqual(layers.get('route-access').paint['line-dasharray'],[2,2]);
 for(const id of ['route-outline','route-path','route-access'])assert.deepEqual(layers.get(id).paint['line-opacity'],['coalesce',['get','opacity'],1]);
});
