import {getSkyPosition, type SkyObserver, type SkyTimeInterval} from './astronomy';
import {getConstellationDirection} from './constellations';
import {findSkyTargetPreview} from './moonGuideGeometry';
import type {TerrainHorizon} from './terrainHorizon';

interface Request {
  id:string; day:SkyTimeInterval; observer:SkyObserver; terrain:TerrainHorizon|null; time:number;
}

self.onmessage=({data}:{data:Request})=>{
  const {id,day,observer,terrain,time}=data;
  const isBody=id==='sun'||id==='moon';
  const directionAt=(t:number)=>isBody ? getSkyPosition(t,observer)[id as 'sun'|'moon'] : getConstellationDirection(t,observer,id);
  const darkAt=isBody ? undefined : (t:number)=>getSkyPosition(t,observer).sun.altitudeDeg <= (id==='milky-way'?-12:-6);
  self.postMessage(findSkyTargetPreview(day,terrain,time,directionAt,darkAt));
};
