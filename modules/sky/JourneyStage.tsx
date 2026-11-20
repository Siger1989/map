import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createSkyScene } from './skyScene';
import { getSkyPosition } from './astronomy';
import { localMinute } from './journeyClock';
import { SatelliteTerrainCanvas } from './SatelliteTerrainCanvas';
import type { DeviceSkyPose } from './deviceSkyCamera';

export type ImageryStatus='loading'|'ready'|'partial'|'unavailable'|'error';
interface Props {
  position:readonly [number,number]; altitude:number|null; pose:DeviceSkyPose; time:number; zone:string;
  name:string; progress:number; distance:number; total:number; width:number; height:number;
  onFrame(canvas:HTMLCanvasElement,fraction:number):void; onCanvas(canvas:HTMLCanvasElement|null):void; onImagery(status:ImageryStatus):void;
}

/** The visible stages and the movie use the same camera, DEM imagery and clock. */
export function JourneyStage({position,altitude,pose,time,zone,name,progress,distance,total,width,height,onCanvas,onImagery,onFrame}:Props) {
  const [base,setBase]=useState<HTMLCanvasElement|null>(null);
  const [terrain,setTerrain]=useState<HTMLCanvasElement|null>(null);
  const [output,setOutput]=useState<HTMLCanvasElement|null>(null);
  const satelliteRevision=useRef(0);
  const scene=useRef<ReturnType<typeof createSkyScene>|null>(null);
  const [error,setError]=useState('');
  const observer=useMemo(()=>({longitude:position[0],latitude:position[1],elevationM:altitude??0}),[position[0],position[1],altitude]);
  const sky=useMemo(()=>getSkyPosition(time,observer),[time,observer]);
  const optics=useMemo(()=>({verticalFov:65,horizontalFov:2*Math.atan(Math.tan(65*Math.PI/360)*width/Math.max(1,height))*180/Math.PI}),[width,height]);
  useLayoutEffect(()=>{
    if(!base)return;
    try{scene.current=createSkyScene(base,true);setError('');}
    catch{setError('当前设备无法绘制行程画面');}
    return ()=>{scene.current?.dispose();scene.current=null;};
  },[base]);
  const stamp=useMemo(()=>localMinute(time,zone).replace('T',' '),[Math.floor(time/60000),zone]);
  const current=useRef({stamp,time,zone,name,progress,distance,total,width,height,observer,pose,optics,sky});
  current.current={stamp,time,zone,name,progress,distance,total,width,height,observer,pose,optics,sky};
  useEffect(()=>{
    if(!base || !output || !scene.current)return;
    const ctx=output.getContext('2d',{alpha:false});
    if(!ctx)return;
    let raf=0, priorDraw=-Infinity, priorSatellite=-1, priorSky:typeof current.current|null=null;
    function draw(now:number){
      raf=requestAnimationFrame(draw);
      if(now-priorDraw<32 || document.hidden)return;
      priorDraw=now;
      const p=current.current;
      if(priorSky===p && priorSatellite===satelliteRevision.current){
        onFrame(output!,p.progress);
        return;
      }
      priorSatellite=satelliteRevision.current;
      if(priorSky!==p){
        scene.current!.draw(p.pose,p.optics,p.sky,null,false);
        priorSky=p;
      }
      const scale=Math.min(1.5,960/Math.max(p.width,p.height));
      const w=Math.max(1,2*Math.round(p.width*scale/2)),h=Math.max(1,2*Math.round(p.height*scale/2));
      if(output!.width!==w||output!.height!==h){output!.width=w;output!.height=h;}
      ctx!.drawImage(base!,0,0,w,h);
      if(terrain?.width&&terrain.height)ctx!.drawImage(terrain,0,0,w,h);
      ctx!.save();ctx!.scale(w/p.width,h/p.height);
      const hud=ctx!;
      const caption=(name:string,az:number,alt:number)=>name+' '+Math.round(az)+'° / '+(alt>=0?'+':'')+Math.round(alt)+'°';
      hud.font='12px sans-serif';
      const sun=caption('太阳',p.sky.sun.azimuthDeg,p.sky.sun.altitudeDeg);
      const moon=caption('月亮',p.sky.moon.azimuthDeg,p.sky.moon.altitudeDeg);
      const sunWidth=hud.measureText(sun).width,moonWidth=hud.measureText(moon).width;
      hud.fillStyle='rgba(14,26,34,.78)';hud.fillRect(8,8,sunWidth+moonWidth+36,27);
      hud.fillStyle='#ffcd70';hud.fillText(sun,16,26);hud.fillStyle='#d6e6ff';hud.fillText(moon,28+sunWidth,26);
      hud.fillStyle='rgba(14,26,34,.8)';hud.fillRect(0,p.height-66,p.width,66);
      hud.fillStyle='#f8faf4';hud.font='bold 15px sans-serif';
      hud.fillText(p.stamp,14,p.height-41);
      hud.textAlign='right';hud.font='13px sans-serif';hud.fillText((p.distance/1000).toFixed(2)+' / '+(p.total/1000).toFixed(2)+' km',p.width-14,p.height-41);
      hud.fillStyle='#54646a';hud.fillRect(14,p.height-31,p.width-28,3);hud.fillStyle='#f3c05e';hud.fillRect(14,p.height-31,(p.width-28)*p.progress,3);
      hud.fillStyle='#e3e9e8';hud.font='11px sans-serif';hud.fillText('影像 © 天地图',p.width-14,p.height-9);
      hud.textAlign='left';hud.fillText(p.name,14,p.height-9,p.width-135);
      hud.restore();
      onFrame(output!,p.progress);
    }
    raf=requestAnimationFrame(draw);
    onCanvas(output);
    return ()=>{cancelAnimationFrame(raf);onCanvas(null);};
  },[base,terrain,output,onCanvas,onFrame]);
  return <div className="journey-stage">
    <canvas className="journey-source" ref={setBase}/>
    <div className="journey-satellite-source"><SatelliteTerrainCanvas observer={observer} pose={pose} optics={optics} width={width} height={height}
      eyeHeightMeters={4.5} onStatus={onImagery} onRender={()=>{satelliteRevision.current++;}} canvasRef={setTerrain}/></div>
    <canvas className="journey-composite" ref={setOutput} aria-label="第一人称行程与录像画面"/>
    {error && <div className="journey-error" role="alert">{error}</div>}
  </div>;
}
