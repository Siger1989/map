import {useLayoutEffect, useRef} from 'react';
import {drawConstellations, type createConstellationFrame} from './constellations';
import type {DeviceSkyOptics, DeviceSkyPose} from './deviceSkyCamera';
import {terrainHorizonAt, type TerrainHorizon} from './terrainHorizon';

interface Props {
  pose:DeviceSkyPose; optics:DeviceSkyOptics; width:number; height:number;
  frame:ReturnType<typeof createConstellationFrame>; terrain:TerrainHorizon|null;
  sunAltitudeDeg:number; selected:string; showConstellations:boolean; showMilkyWay:boolean;
}

export function SkyStarLayer(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{
    const element=canvas.current;
    if(!element)return;
    const ctx=element.getContext('2d');
    if(!ctx)return;
    const {width,height,pose,optics,frame,terrain}=props;
    const scale=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(width*scale)), h=Math.max(1,Math.round(height*scale));
    if(element.width!==w||element.height!==h){element.width=w;element.height=h;}
    ctx.setTransform(scale,0,0,scale,0,0);
    ctx.clearRect(0,0,width,height);
    drawConstellations(ctx,width,height,pose,optics,frame,{
      showConstellations:props.showConstellations,showMilkyWay:props.showMilkyWay,
      selected:props.selected,sunAltitudeDeg:props.sunAltitudeDeg,
      horizonAt:terrain ? (azimuth:number)=>terrainHorizonAt(terrain,azimuth) : undefined,
    });
  },[props.pose,props.optics,props.width,props.height,props.frame,props.terrain,props.selected,props.showConstellations,props.showMilkyWay,props.sunAltitudeDeg]);
  return <canvas ref={canvas} aria-label="星座与银河" style={{pointerEvents:'none'}}/>;
}
