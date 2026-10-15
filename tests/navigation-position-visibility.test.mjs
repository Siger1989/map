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

test('navigation puck follows real position state and clears on stop or a missing fix', async () => {
  await build({entryPoints:['modules/position/PositionLayer.ts'],outfile:'.openai/nav-reference-20261014/PositionLayer-test.mjs',bundle:true,format:'esm',platform:'node',packages:'external'});
  const {PositionLayer}=await import('../.openai/nav-reference-20261014/PositionLayer-test.mjs');
  const sources=new Map(), layers=[], images=new Map();
  const map={getSource:id=>sources.get(id),addSource(id){sources.set(id,{setData(data){this.data=data}})},
    getLayer:id=>layers.find(l=>l.id===id),addLayer:l=>layers.push(l),getStyle:()=>({layers}),
    hasImage:id=>images.has(id),addImage:(id,image,options)=>images.set(id,{image,options}),
    moveLayer(id){const i=layers.findIndex(l=>l.id===id);layers.push(...layers.splice(i,1))},on(){},off(){},
    getContainer:()=>({querySelectorAll:()=>[],getBoundingClientRect:()=>({left:0,top:0,width:390,height:857}),addEventListener(){},removeEventListener(){}})};
  const layer=new PositionLayer(map), fix={coordinates:[104,30],accuracy:8,timestamp:Date.now()};
  const point=()=>sources.get('current-position').data.features.find(f=>f.geometry.type==='Point');
  layer.sync(fix,30,true);
  assert.equal(point().properties.navigating,true);
  const navArrow=images.get('position-navigation-arrow');
  assert.equal(navArrow.image.width,144,'navigation arrow uses an 8x texture width');
  assert.equal(navArrow.image.height,176,'navigation arrow uses an 8x texture height');
  assert.equal(navArrow.options.pixelRatio,8,'high-density texture preserves its logical marker dimensions');
  const arrowPixels=new Set();
  for(let i=0;i<navArrow.image.data.length;i+=4)if(navArrow.image.data[i+3])arrowPixels.add(navArrow.image.data.slice(i,i+3).join(','));
  assert.ok(arrowPixels.has('0,68,157'),'left facet is shaded');
  assert.ok(arrowPixels.has('25,151,255'),'right facet is lit');
  assert.ok([...arrowPixels].some(pixel=>{const [r,g,b]=pixel.split(',').map(Number);return r>110&&g>190&&b>240;}),'ridge highlight is rendered');
  assert.ok(arrowPixels.has('2,37,91'),'dark beveled outline is rendered');
  assert.equal(JSON.stringify(layers.find(l=>l.id==='position-arrow').layout['icon-image']).includes('position-navigation-arrow'),true,'navigation keeps using its own blue arrow image');
  for (const id of ['position-navigation-glow','position-navigation-puck']) {
    const spec=layers.find(l=>l.id===id);
    assert.ok(spec.filter.some(part=>Array.isArray(part)&&JSON.stringify(part).includes('navigating')));
    assert.equal(spec.paint['circle-pitch-scale'],'viewport','white puck must retain its screen size at a steep pitch');
  }
  assert.equal(point().properties.closeView,false,'ordinary navigation keeps the regular screen-space puck');
  layer.sync(fix,30,true,true);
  assert.equal(point().properties.closeView,true,'only the explicit fourth argument enables the close-view puck');
  for (const id of ['position-navigation-close-glow','position-navigation-close-puck']) {
    const spec=layers.find(l=>l.id===id);
    assert.ok(spec.filter.some(part=>Array.isArray(part)&&JSON.stringify(part).includes('closeView')&&part.at(-1)===true));
    assert.equal(spec.paint['circle-pitch-alignment'],'map','close-view puck follows the ground plane and can appear elliptical');
    assert.equal(spec.paint['circle-pitch-scale'],'map');
  }
  layer.sync(fix,30,false);
  assert.equal(point().properties.navigating,false,'ending navigation restores the regular marker');
  assert.equal(point().properties.closeView,false,'ending navigation clears the close-view state');
  layer.sync({...fix,provider:'ip'},30,true);
  assert.equal(point().properties.navigating,false,'an IP estimate must never receive the navigation puck');
  layer.sync(null,null,true);
  assert.deepEqual(sources.get('current-position').data.features,[],'location loss cannot leave an apparently live puck');
});
