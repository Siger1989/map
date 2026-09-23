import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints: ['modules/mapSources/RasterCoordinates.ts', 'modules/mapSources/coordinates.ts'], bundle: true, platform: 'node', format: 'esm', write: false, outdir: '.openai/coordinate-tests', plugins: [{name:'worker-url', setup(build) {
  build.onResolve({filter:/\?worker&url$/}, () => ({path:'worker-url', namespace:'test'}));
  build.onLoad({filter:/.*/, namespace:'test'}, () => ({contents:'export default "worker.js"'}));
}}] });
const modules = await Promise.all(result.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.contents).toString('base64'))));
const { fromWgs84, worldPixel, warpPlan, rasterDatumKey, WARP_GRID } = modules.find(m=>m.warpPlan);
const { RasterCoordinates, rasterTileUrl } = modules.find(m=>m.RasterCoordinates);

test('known Beijing datum offset has the correct direction; WGS84 is identity', () => {
  const point = [116.404,39.915];
  assert.deepEqual(fromWgs84(...point, 'wgs84'), point);
  const gcj = fromWgs84(...point, 'gcj02');
  assert.ok(Math.abs(gcj[0]-116.4102445)<1e-7);
  assert.ok(Math.abs(gcj[1]-39.9164043)<1e-7);
  const bd = fromWgs84(...point, 'bd09');
  assert.ok(bd[0]>gcj[0]+0.006 && bd[1]>gcj[1]+0.005);
  assert.deepEqual(fromWgs84(-74,40,'gcj02'), [-74,40]);
});
test('adjacent corrected tiles share exactly the same source edge at several zooms', () => {
  for (const datum of ['wgs84','gcj02','bd09']) for (const z of [3,12,18]) {
    const [px,py] = worldPixel(103.63,31.74,256*2**z), x=Math.floor(px/256),y=Math.floor(py/256);
    const a=warpPlan(z,x,y,256,datum), b=warpPlan(z,x+1,y,256,datum);
    assert.ok(a.width*a.height<=16);
    for(let row=0;row<=WARP_GRID;row++) for(let axis=0;axis<2;axis++) {
      assert.ok(Math.abs(a.points[(row*(WARP_GRID+1)+WARP_GRID)*2+axis]-b.points[row*(WARP_GRID+1)*2+axis])<1e-6);
    }
  }
});
test('source identity, datum persistence keys and restoration do not mix providers or rewrite camera', () => {
  let reloads=0;
  const source={type:'raster',id:'detail',tiles:['https://example.test/{z}/{x}/{y}.png'],scheme:'tms',setTiles(tiles){reloads++;this.tiles=tiles;}};
  const untouched={type:'raster-dem',id:'elevation'};
  const map={getSource:id=>id==='detail'?source:untouched};
  const coordinates=new RasterCoordinates(map,()=>{});
  coordinates.sync(['detail'],'gcj02');
  assert.equal(reloads,1); assert.equal(source.scheme,'xyz'); assert.match(source.tiles[0],/^shantu-crs-/);
  for(let i=0;i<10;i++) coordinates.sync(['detail'],'gcj02');
  assert.equal(reloads,1);
  coordinates.sync(['detail'],'wgs84');
  assert.equal(reloads,2); assert.equal(source.scheme,'tms'); assert.equal(source.tiles[0],'https://example.test/{z}/{x}/{y}.png');
  assert.equal(untouched.tiles,undefined);
  assert.notEqual(rasterDatumKey({satellite:true,satelliteProvider:'sentinel',imageryMode:'detail'}),rasterDatumKey({satelliteProvider:'tianditu',tiandituBase:'img'}));
  coordinates.dispose();
});
test('source URLs preserve TMS, world wrap and Web Mercator WMS bounds',()=>{
  assert.equal(rasterTileUrl(['https://example.test/{z}/{x}/{y}'],2,-1,1,'tms'),'https://example.test/2/3/2');
  const url=rasterTileUrl(['https://example.test/?bbox={bbox-epsg-3857}'],0,0,0,'xyz');
  const values=new URL(url).searchParams.get('bbox').split(',').map(Number);
  assert.ok(values[0]<-20037508 && values[3]>20037508);
});
