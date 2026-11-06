import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { contourInterval, contourMinimumZoom, contourTileOptions, readContourInterval, saveContourInterval, CONTOUR_INTERVAL_KEY } from '../modules/terrain/contourInterval.ts';
import { contrastContourColor, contourColorExpressionForInterval, elevationColorsForInterval, elevationExpressionForInterval, elevationFillColor, elevationFillExpression, ELEVATION_FILL_COLORS_25, ELEVATION_FILL_STEP_METERS, highContrastContourColorExpression } from '../modules/terrain/elevationColors.ts';

test('selected contour spacing stays exact at every zoom and layer visibility has a view-wide threshold', () => {
  for(let z=7;z<=20;z++) for(const interval of [30,50,100,200]) {
    const options=contourTileOptions(interval,z);
    assert.equal(options.overzoom,0);
    assert.equal(options.extent,8192);
    assert.deepEqual(options.levels,[interval,interval*5]);
  }
  assert.deepEqual([30,50,100,200].map(contourMinimumZoom),[11,10,9,8]);
  for(const invalid of [undefined,10,20,60,120,NaN,'30'])assert.equal(contourInterval(invalid),30);
});
test('elevation color bands use the selected interval with zero as their common datum',()=>{
  for(const interval of [30,50,100,200]) {
    const bands=elevationColorsForInterval(interval).map(([height])=>height);
    assert.ok(bands.includes(0));
    assert.ok(bands.every(height=>height%interval===0));
    assert.ok(bands[0]<=-500);
    assert.ok(bands.at(-1)>=9000);
    assert.ok(elevationExpressionForInterval(interval).length>0);
  }
  assert.ok(elevationColorsForInterval(30).length>elevationColorsForInterval(200).length);
  assert.equal(elevationExpressionForInterval(30),elevationExpressionForInterval(30));
  assert.notEqual(elevationExpressionForInterval(30),elevationExpressionForInterval(50));
  assert.equal(contourColorExpressionForInterval(30),contourColorExpressionForInterval(30));
});
test('terrain fill uses one fixed 25m palette independent of contour interval or map zoom',()=>{
  assert.equal(ELEVATION_FILL_STEP_METERS,25);
  assert.equal(ELEVATION_FILL_COLORS_25.length,381);
  assert.ok(ELEVATION_FILL_COLORS_25.some(([height])=>height===0));
  assert.equal(ELEVATION_FILL_COLORS_25.filter(([height])=>height>=0&&height<1000).length,40);
  assert.ok(ELEVATION_FILL_COLORS_25.every(([height],index,all)=>index===0||height-all[index-1][0]===25));
  assert.equal(elevationFillColor(-0.1),elevationFillColor(-25),'negative banding uses mathematical floor');
  assert.equal(elevationFillColor(0),'#137b63');
  assert.equal(elevationFillColor(1000),'#b5dd2a');
  assert.equal(elevationFillColor(-900),ELEVATION_FILL_COLORS_25[0][1]);
  assert.equal(elevationFillColor(9000),ELEVATION_FILL_COLORS_25.at(-1)[1]);
  assert.deepEqual(elevationFillExpression[2],['elevation']);
  assert.equal(elevationFillExpression.length,3+2+(ELEVATION_FILL_COLORS_25.length-1)*4);
  for(let i=1;i<ELEVATION_FILL_COLORS_25.length;i++) {
    const [height,color]=ELEVATION_FILL_COLORS_25[i];
    const offset=5+(i-1)*4;
    assert.deepEqual(elevationFillExpression.slice(offset,offset+4),[
      height-0.25,ELEVATION_FILL_COLORS_25[i-1][1],height,color,
    ]);
  }
  assert.notEqual(elevationColorsForInterval(30).length,elevationColorsForInterval(200).length,
    'legacy interval palettes remain available for isolated colored contours');
});
test('combined fill and contours use a fixed-step black/white contrast expression',()=>{
  assert.equal(contrastContourColor(0),'#FFFFFF');
  assert.equal(contrastContourColor(1000),'#000000');
  assert.equal(highContrastContourColorExpression[0],'step');
  assert.deepEqual(highContrastContourColorExpression[1],['to-number',['get','ele']]);
  assert.equal(highContrastContourColorExpression[3],-475);
  assert.equal(highContrastContourColorExpression[4],contrastContourColor(-475));
});
test('vertical interval persists and damaged storage uses 30m',()=>{
  let value='100';const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>{assert.equal(k,CONTOUR_INTERVAL_KEY);return value;},setItem:(k,v)=>{assert.equal(k,CONTOUR_INTERVAL_KEY);value=v;}}});
  try{assert.equal(readContourInterval(),100);saveContourInterval(50);assert.equal(readContourInterval(),50);value='{bad';assert.equal(readContourInterval(),30);}
  finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}
});
test('installed contour engine changes isoline geometry at every interval and reuses the same DEM',async()=>{
  const contour=createRequire(import.meta.url)('maplibre-contour');const requests=[];
  const { VectorTile }=createRequire(import.meta.url)('@mapbox/vector-tile');
  const { PbfReader }=createRequire(import.meta.url)('pbf');
  const manager=new contour.LocalDemManager({demUrlPattern:'https://fixture.invalid/{z}/{x}/{y}.png',encoding:'terrarium',maxzoom:12,cacheSize:40,timeoutMs:1000,
    getTile:async url=>{requests.push(url);return{data:new Blob()};},
    decodeImage:async()=>({width:256,height:256,data:Float32Array.from({length:256*256},(_,i)=>1000+(i%256)*8)})});
  const tiles=[];let count=0;
  for(const interval of [30,50,100,200]){
    const r=await manager.fetchContourTile(14,8192,8192,contourTileOptions(interval,14),new AbortController());
    tiles.push(Buffer.from(r.arrayBuffer));assert.ok(r.arrayBuffer.byteLength>0);
    if(count)assert.equal(requests.length,count);count=requests.length;
  }
  for(let i=1;i<tiles.length;i++) assert.notDeepEqual(tiles[i-1],tiles[i]);
  const decoded=new VectorTile(new PbfReader(tiles[0]));
  assert.equal(decoded.layers.contours.extent,8192);
  assert.ok(requests.every(url=>new URL(url).pathname.startsWith('/12/')));
});
