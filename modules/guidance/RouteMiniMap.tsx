import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { LayerSettings } from '../map/types';
import { routeBounds } from '../routeShare/data';
import { basemapConfiguration, tiandituTiles } from '../cartography/basemaps';
import { tiandituBase, TIANDITU_LAYERS } from '../cartography/tianditu';
import { offlineProtocol, offlineTransform } from '../outdoor/offline';
import { offlineMapOnly } from '../outdoor/tileCache';
type Option={id:string;coordinates:Coordinate[];color:string};
export function RouteMiniMap({coordinates,color='#c2513f',routes,selectedId='original',settings}: {
  coordinates:Coordinate[];color?:string;routes?:Option[];selectedId?:string;settings?:LayerSettings;
}) {
  const container=useRef<HTMLDivElement>(null), update=useRef<()=>void>(()=>{});
  const options=routes??[{id:'original',coordinates,color}];
  const latest=useRef({options,selectedId,coordinates});latest.current={options,selectedId,coordinates};
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  const domestic=basemapConfiguration(),base=settings?tiandituBase(settings):'img';
  useEffect(()=>{
    let disposed=false, map:import('maplibre-gl').Map|undefined;
    const markers:import('maplibre-gl').Marker[]=[];
    setError('底图加载中…');
    const timer=setTimeout(()=>{if(!disposed)setError('底图暂未加载，可重试；路线仍可查看');},15000);
    void import('maplibre-gl').then(ml=>{
      if(disposed || !container.current)return;
      ml.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');ml.addProtocol('tripcache',offlineProtocol);
      map=new ml.Map({container:container.current,interactive:false,attributionControl:false,fadeDuration:0,transformRequest:offlineTransform,
        bounds:routeBounds(latest.current.options.map(r=>r.coordinates)),fitBoundsOptions:{padding:30,maxZoom:16},
        style:{version:8,sources:{base:{type:'raster',tiles:domestic.domestic?tiandituTiles(base,domestic.token):['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:domestic.domestic?Math.min(TIANDITU_LAYERS[base].maxzoom,offlineMapOnly()?settings?.offlineMaxZoom??18:18):19},routes:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[
          {id:'background',type:'background',paint:{'background-color':'#dce6d5'}},{id:'base',type:'raster',source:'base'},
          {id:'other',type:'line',source:'routes',filter:['==',['get','selected'],false],paint:{'line-color':['get','color'],'line-width':3,'line-opacity':0.5}},
          {id:'outline',type:'line',source:'routes',filter:['==',['get','selected'],true],paint:{'line-color':'#fff','line-width':7}},
          {id:'selected',type:'line',source:'routes',filter:['==',['get','selected'],true],paint:{'line-color':['get','color'],'line-width':4}}
        ]}});
      update.current=()=>{
        if(!map?.getSource('routes'))return;
        const v=latest.current,bounds=routeBounds(v.options.map(r=>r.coordinates)),center=(bounds[0][0]+bounds[1][0])/2;
        const unwrap=([lng,lat]:Coordinate):Coordinate=>[center+((((lng-center+180)%360)+360)%360)-180,lat];
        (map.getSource('routes') as import('maplibre-gl').GeoJSONSource).setData({type:'FeatureCollection',features:v.options.map(r=>({type:'Feature',properties:{selected:r.id===v.selectedId,color:r.color},geometry:{type:'LineString',coordinates:r.coordinates.map(unwrap)}}))});
        map.fitBounds(bounds,{padding:30,maxZoom:16,duration:0});markers.splice(0).forEach(m=>m.remove());
        if(v.coordinates.length && v.selectedId)for(const [i,p] of [v.coordinates[0],v.coordinates.at(-1)!].entries()){
          const element=document.createElement('span');element.className=`route-endpoint-badge ${i?'is-end':'is-start'}`;element.textContent=i?'终':'起';
          markers.push(new ml.Marker({element}).setLngLat(unwrap(p)).addTo(map));
        }
      };
      map.on('style.load',()=>update.current());
      if(map.isStyleLoaded())update.current();
      map.on('sourcedata',event=>{if(event.sourceId==='base' && event.tile && event.isSourceLoaded){clearTimeout(timer);if(!disposed)setError('');}});
      map.on('error',()=>{if(!disposed)setError('底图加载失败，请检查网络或缓存后重试');});
    }).catch(()=>{if(!disposed)setError('底图暂不可用，请重试');});
    return()=>{disposed=true;clearTimeout(timer);update.current=()=>{};markers.forEach(m=>m.remove());map?.remove();};
  },[base,domestic.domestic,domestic.token,retry,settings?.offlineMaxZoom]);
  const geometry=JSON.stringify([options,selectedId,coordinates]);
  useEffect(()=>update.current(),[geometry]);
  return <section className="route-mini-overview" aria-label="路线缩略图：选中路线高亮，其他方案淡色显示">
    <div ref={container} className="route-mini-map"/><span className="route-mini-north">北 ↑</span>
    <a href={domestic.domestic?'https://www.tianditu.gov.cn/':'https://www.openstreetmap.org/copyright'} target="_blank" rel="noreferrer">{domestic.domestic?'© 天地图':'© OpenStreetMap'}</a>
    {error && <small role="status">{error}<button onClick={()=>setRetry(n=>n+1)}>重试</button></small>}
  </section>;
}
