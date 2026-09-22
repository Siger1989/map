import type { Map as LibreMap } from 'maplibre-gl';
import type { TripPackage } from './offline';
import { tdtIdentity } from './tiandituCache';
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
  const cleanup=()=>{clearTimeout(timer);label.remove();for(const layer of [id+'-edge',id+'-fill'])if(map.getLayer(layer))map.removeLayer(layer);if(map.getSource(id))map.removeSource(id);};
  map.addSource(id,{type:'geojson',data:coverage.data});
  map.addLayer({id:id+'-fill',type:'fill',source:id,paint:{'fill-color':'#20c565','fill-opacity':coverage.filled?0.22:0}});
  map.addLayer({id:id+'-edge',type:'line',source:id,paint:{'line-color':'#16a34a','line-width':3}});
  const label=document.createElement('div');label.className='offline-coverage-label';label.textContent=coverage.label;map.getContainer().appendChild(label);
  const timer=setTimeout(cleanup,3000);
  return cleanup;
}
