import type { Map as LibreMap } from 'maplibre-gl';
import type { TripPackage } from './offline';
import { tdtIdentity } from './tiandituCache.ts';
import { cachePackagePreview } from './cachePackagePreview.ts';
export function coverageGeometry(trip:TripPackage):{data:GeoJSON.FeatureCollection;filled:boolean;label:string} {
  const zoom=Math.min(trip.zoom??14,14),rows=new Map<number,Set<number>>();
  if(trip.complete)for(const url of trip.urls){const id=tdtIdentity(url),parts=id?.split(':');if(!parts || Number(parts[2])!==zoom)continue;const x=Number(parts[3]),y=Number(parts[4]);if(!rows.has(y))rows.set(y,new Set());rows.get(y)!.add(x);}
  const rectangle=(west:number,south:number,east:number,north:number):GeoJSON.Feature<GeoJSON.Polygon>=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}});
  const features:GeoJSON.Feature<GeoJSON.Polygon>[]=[];
  const lon=(x:number)=>x/2**zoom*360-180,lat=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**zoom)))*180/Math.PI;
  for(const [y,cols] of rows){const xs=[...cols].sort((a,b)=>a-b);let start=xs[0],last=start;for(const x of [...xs.slice(1),Infinity]){if(x!==last+1){features.push(rectangle(lon(start),lat(y+1),lon(last+1),lat(y)));start=x;}last=x;}}
  const filled=features.length>0;
  if(!filled)features.push(rectangle(...trip.bounds));
  return {data:{type:'FeatureCollection',features},filled,label:trip.complete?(filled?`${trip.name} · ${zoom}级缓存覆盖`:`${trip.name} · 缓存包外接范围`):`${trip.name} · 未完成包计划范围`};
}
/** A temporary layer only; never changes the offline index or stored tracks. */
export function flashOfflineCoverage(map:LibreMap,trip:TripPackage) {
  const id='shantu-offline-highlight',coverage=coverageGeometry(trip);
  const preview=cachePackagePreview(trip);
  const areaFeatures=preview.geojson.features.filter(f=>f.properties.role==='area-range');
  const data:GeoJSON.FeatureCollection={type:'FeatureCollection',features:[...(areaFeatures.length?areaFeatures:coverage.data.features),...preview.geojson.features.filter(f=>f.properties.role==='route')]};
  const cleanup=()=>{clearTimeout(timer);label.remove();for(const layer of [id+'-route',id+'-edge',id+'-fill'])if(map.getLayer(layer))map.removeLayer(layer);if(map.getSource(id))map.removeSource(id);};
  map.addSource(id,{type:'geojson',data});
  map.addLayer({id:id+'-fill',type:'fill',source:id,paint:{'fill-color':'#20c565','fill-opacity':coverage.filled?0.22:0.04}});
  map.addLayer({id:id+'-edge',type:'line',source:id,filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':'#16a34a','line-width':2}});
  map.addLayer({id:id+'-route',type:'line',source:id,filter:['==',['geometry-type'],'LineString'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#d0f76b','line-width':3}});
  const label=document.createElement('div');label.className='offline-coverage-label';label.textContent=areaFeatures.length?`${trip.name} · 所选区域规划边界 · ${preview.progress.done}/${preview.progress.total}项`:coverage.label;map.getContainer().appendChild(label);
  const timer=setTimeout(cleanup,12000);
  return cleanup;
}
