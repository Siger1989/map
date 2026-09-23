import test from 'node:test';
import assert from 'node:assert/strict';
import { currentShareMapStyle } from '../modules/routeShare/currentMapStyle.ts';
import { trackNoteFeatures } from '../modules/tracks/trackNotes.ts';

test('share image keeps active imagery, terrain, contours and credits without carrying user editing/position data', () => {
  const style = {version:8,glyphs:'/fonts/{fontstack}/{range}.pbf',terrain:{source:'dem',exaggeration:1.4},sources:{
    imagery:{type:'raster',tiles:['shantu-crs-1://1/{z}/{x}/{y}'],attribution:'<a href="https://example.com">Imagery &amp; credit</a>'},
    dem:{type:'raster-dem',tiles:['/dem/{z}/{x}/{y}']},contours:{type:'vector',tiles:['shantu-contours-1://{z}/{x}/{y}?interval=30']},
    hidden:{type:'raster',tiles:['/unused']},'manual-tracks':{type:'geojson',data:{type:'FeatureCollection',features:[{private:'route'}]}},
    'current-position':{type:'geojson',data:{private:'position'}},'temperature-grid':{type:'geojson',data:{type:'FeatureCollection',features:[]}},
  },layers:[
    {id:'background',type:'background'}, {id:'imagery',type:'raster',source:'imagery',paint:{'raster-opacity':0.8}},
    {id:'contours',type:'line',source:'contours','source-layer':'contours'},
    {id:'contour-labels',type:'symbol',source:'contours',layout:{'text-size':11,'symbol-spacing':210}},
    {id:'hidden',type:'raster',source:'hidden',layout:{visibility:'none'}},
    {id:'manual-track-line',type:'line',source:'manual-tracks'}, {id:'position',type:'circle',source:'current-position'},
    {id:'temperature',type:'fill',source:'temperature-grid'}, {id:'model',type:'custom',render(){}},
  ]};
  const current = currentShareMapStyle(style);
  assert.deepEqual(current.style.layers.map(l=>l.id),['background','imagery','contours','contour-labels','temperature']);
  assert.deepEqual(Object.keys(current.style.sources),['imagery','dem','contours','temperature-grid']);
  assert.deepEqual(current.style.terrain,style.terrain);
  assert.equal(current.attribution,'Imagery & credit');
  assert.equal(current.style.layers[3].layout['symbol-spacing'],210);
  current.style.layers[1].paint['raster-opacity']=0.2;
  assert.equal(style.layers[1].paint['raster-opacity'],0.8,'export changes cannot affect the interactive map');
});

test('map notes stay beside contiguous matching edges, respect per-edge overrides, and keep stored text intact',()=>{
  const a=[100,30],b=[100.01,30],c=[100.02,30],d=[100.03,30],e=[100.04,30];
  const track={id:'test',name:'test',createdAt:1,segments:[[a,b,c,d,e]],style:{color:'#00ff00',width:2},edgeColors:[['#0000ff','#0000ff',null,'#0000ff']],colorConditions:{'#0000ff':'宝泉'},edgeNotes:[[null,null,null,'独立路段备注']],pointDetails:{[c.join(',')]:{note:'路口'}}};
  const before=structuredClone(track), features=trackNoteFeatures([track]).features;
  assert.deepEqual(features.map(f=>[f.properties.note,f.geometry.coordinates]),[['宝泉',[a,b,c]],['独立路段备注',[d,e]],['路口',c]]);
  assert.deepEqual(track,before);
  assert.equal(trackNoteFeatures([{...track,hidden:true}]).features.length,0);
  const cleared={...track,edgeNotes:[['','','','']]};
  assert.equal(trackNoteFeatures([cleared]).features.filter(f=>f.geometry.type==='LineString').length,0);
  const long={...track,pointDetails:{[a.join(',')]:{note:'很长的备注'.repeat(20)}}};
  const note=trackNoteFeatures([long]).features.find(f=>f.geometry.type==='Point').properties.note;
  assert.equal([...note].length,19);
  assert.ok(note.endsWith('…'));
});
