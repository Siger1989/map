import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createSkyScene } from './skyScene';
import { getSkyPosition } from './astronomy';
import { localMinute } from './journeyClock';
import { SatelliteTerrainCanvas } from './SatelliteTerrainCanvas';
import type { DeviceSkyPose } from './deviceSkyCamera';
import { resolveJourneyCamera } from './journeyCamera';
import type { JourneyPlaybackFrame, JourneyPlaybackModel } from './journeyPlayback';
import type { JourneyTerrainBuffer } from './satelliteTerrainRenderer';
import { createJourneyStars } from './journeyStars';
import type { JourneySkyLayerSettings } from './JourneySkyLayers';

export type ImageryStatus='loading'|'ready'|'partial'|'unavailable'|'error';
interface Props {
  model: JourneyPlaybackModel; frame: JourneyPlaybackFrame; time:number; zone:string;
  name:string; progress:number; width:number; height:number;
  captureFrames:boolean; retryKey:number;
  layers:JourneySkyLayerSettings;
  onBuffer(buffer:JourneyTerrainBuffer):void; onPresent(fraction:number):void;
  onFrame(canvas:HTMLCanvasElement,fraction:number):void; onCanvas(canvas:HTMLCanvasElement|null):void; onImagery(status:ImageryStatus):void;
}

/** The visible stages and the movie use the same camera, DEM imagery and clock. */
export function JourneyStage({model,frame,time,zone,name,progress,width,height,layers,captureFrames,retryKey,onBuffer,onPresent,onCanvas,onImagery,onFrame}:Props) {
  const [base,setBase]=useState<HTMLCanvasElement|null>(null);
  const [terrain,setTerrain]=useState<HTMLCanvasElement|null>(null);
  const [stars,setStars]=useState<HTMLCanvasElement|null>(null);
  const starLayer=useRef<ReturnType<typeof createJourneyStars>|null>(null);
  const [output,setOutput]=useState<HTMLCanvasElement|null>(null);
  const satelliteRevision=useRef(0);
  const rendered = useRef<{ frame: JourneyPlaybackFrame; pose: DeviceSkyPose; routeReady: boolean; width: number; height: number } | null>(null);
  const terrainStatus = useRef<ImageryStatus>('loading');
  const drawable = useRef(false);
  const terrainPreview = useRef(false);
  const imageryVisible = useRef(false);
  const hasPresentedTerrain = useRef(false);
  const redraw = useRef<(() => void) | null>(null);
  useLayoutEffect(()=>{
    if(!stars)return;
    const renderer=createJourneyStars(stars,()=>{satelliteRevision.current++;redraw.current?.();});
    starLayer.current=renderer;
    return ()=>{starLayer.current=null;renderer.dispose();};
  },[stars]);
  const rememberBuffer = useCallback((buffer:JourneyTerrainBuffer) => {
    drawable.current = buffer.frameReady;
    terrainPreview.current = buffer.frameTerrainOnly === true;
    imageryVisible.current = buffer.frameHasImagery ?? !terrainPreview.current;
    onBuffer(buffer);
  }, [onBuffer]);
  const scene=useRef<ReturnType<typeof createSkyScene>|null>(null);
  const [error,setError]=useState('');
  const optics=useMemo(()=>({verticalFov:65,horizontalFov:2*Math.atan(Math.tan(65*Math.PI/360)*width/Math.max(1,height))*180/Math.PI}),[width,height]);
  const route = useMemo(() => ({model, frame}), [model, frame]);
  const fallback = useMemo(() => resolveJourneyCamera(frame, optics), [frame, optics]);
  const observer = useMemo(() => ({
    longitude: frame.cameraCoordinates[0], latitude: frame.cameraCoordinates[1], elevationM: frame.cameraElevationM ?? 0,
  }), [frame]);
  const sky = useMemo(() => getSkyPosition(time, {
    longitude: frame.coordinates[0], latitude: frame.coordinates[1], elevationM: frame.elevationM ?? 0,
  }), [frame, time]);
  const rememberCamera = useCallback((view: { pose: DeviceSkyPose; routeReady: boolean }) => {
    rendered.current = { frame, width, height, pose: view.pose, routeReady: view.routeReady };
  }, [frame, width, height]);
  const rememberStatus = useCallback((status: ImageryStatus) => {
    terrainStatus.current = status;
    if (status !== 'ready' && status !== 'partial') {
      satelliteRevision.current++;
      onImagery(status);
    }
  }, [onImagery]);
  const terrainDrawn = useCallback(() => {
    satelliteRevision.current++;
    const status = terrainStatus.current;
    const hasRoute = rendered.current?.frame === frame && rendered.current.routeReady;
    onImagery((status === 'ready' || status === 'partial') && !hasRoute ? 'loading' : status);
    redraw.current?.();
  }, [frame, onImagery]);
  useLayoutEffect(()=>{
    if(!base)return;
    try{scene.current=createSkyScene(base,true,1.5);setError('');}
    catch{setError('当前设备无法绘制行程画面');}
    return ()=>{scene.current?.dispose();scene.current=null;};
  },[base]);
  const stamp=useMemo(()=>localMinute(time,zone).replace('T',' '),[Math.floor(time/60000),zone]);
  const shot = useMemo(() => ({stamp, name, progress, distance:frame.distanceM, total:model.totalDistanceM,
    width, height, frame, fallbackPose:fallback.pose, optics, sky, time, layers,captureFrames}),
    [stamp, name, progress, frame, model, width, height, fallback, optics, sky,time,layers,captureFrames]);
  const current = useRef(shot);
  current.current = shot;
  useLayoutEffect(()=>{
    if(!base || !output || !scene.current)return;
    const ctx=output.getContext('2d',{alpha:true});
    if(!ctx)return;
    let raf=0, priorSatellite=-1, priorShot:typeof shot|null=null,starsReady=true;
    let previousPose:DeviceSkyPose|null=null, previousTerrain=false, fullComposite=false, priorCredit='';
    function draw(){
      if(document.hidden)return;
      const p=current.current;
      const view = rendered.current;
      const hasTerrain = terrainStatus.current === 'partial' || terrainStatus.current === 'ready';
      const synced = view?.frame === p.frame && view.width === p.width && view.height === p.height;
      // The map runs in its own animation frame. Never encode the previous arrow under a new time or distance.
      if(hasTerrain && !synced) return;
      const recordable = hasTerrain && synced && view.routeReady && drawable.current;
      // The terrain renderer holds its last complete frame while seeking or buffering.
      // Keep the corresponding sky, arrow time and HUD until the new frame can replace it.
      if(hasPresentedTerrain.current && !recordable)return;
      if(recordable)hasPresentedTerrain.current=true;
      // A busy video encoder needs another chance to accept this same frame.
      if(p.captureFrames && recordable && !raf)raf=requestAnimationFrame(()=>{raf=0;draw();});
      if(priorShot===p && priorSatellite===satelliteRevision.current){
        if(p.captureFrames && recordable && starsReady)onFrame(output!,p.progress);
        return;
      }
      const pose=synced ? view.pose : p.fallbackPose;
      const credit = !hasTerrain ? '' : terrainPreview.current
        ? (imageryVisible.current ? '地形预览 · © 天地图' : '地形预览') : '影像 © 天地图';
      const unchanged=priorCredit===credit && priorShot===p && previousTerrain===hasTerrain && previousPose?.azimuth===pose.azimuth &&
        previousPose.altitude===pose.altitude && previousPose.roll===pose.roll;
      priorSatellite=satelliteRevision.current;
      priorShot=p;previousPose=pose;previousTerrain=hasTerrain;priorCredit=credit;
      // An off-screen tile finishing its download does not change the visible sky or HUD.
      if(unchanged && !p.captureFrames && starsReady){
        if(recordable)onPresent(p.progress);
        return;
      }
      scene.current!.draw(pose,p.optics,p.sky,null,false,hasTerrain,p.layers);
      const showStars=p.layers.constellations||p.layers.milkyWay;
      starsReady=!showStars || !!starLayer.current?.draw({
        time:p.time,observer:{longitude:p.frame.coordinates[0],latitude:p.frame.coordinates[1],elevationM:p.frame.elevationM??0},
        pose,optics:p.optics,width:p.width,height:p.height,layers:p.layers,sunAltitudeDeg:p.sky.sun.altitudeDeg,
      });
      const scale=Math.min(window.devicePixelRatio || 1,2,1440/Math.max(p.width,p.height));
      const w=Math.max(1,2*Math.round(p.width*scale/2)),h=Math.max(1,2*Math.round(p.height*scale/2));
      if(output!.width!==w||output!.height!==h){output!.width=w;output!.height=h;}
      // During playback the browser composites the two WebGL surfaces directly.
      // Reading both back into 2D is only necessary for an actual video frame.
      if(fullComposite || p.captureFrames)ctx!.clearRect(0,0,w,h);
      else {
        ctx!.clearRect(0,0,w,Math.ceil(36*h/p.height));
        const bottom=Math.floor((p.height-66)*h/p.height);
        ctx!.clearRect(0,bottom,w,h-bottom);
      }
      fullComposite=p.captureFrames;
      if(p.captureFrames){
        ctx!.drawImage(base!,0,0,w,h);
        if(showStars && stars?.width && stars.height)ctx!.drawImage(stars,0,0,w,h);
        if(hasTerrain && synced && terrain?.width && terrain.height)ctx!.drawImage(terrain,0,0,w,h);
      }
      ctx!.save();ctx!.scale(w/p.width,h/p.height);
      const hud=ctx!;
      const caption=(name:string,az:number,alt:number)=>name+' '+Math.round(az)+'° / '+(alt>=0?'+':'')+Math.round(alt)+'°';
      hud.font='12px sans-serif';
      const sun=p.layers.sun?caption('太阳',p.sky.sun.azimuthDeg,p.sky.sun.altitudeDeg):'';
      const moon=p.layers.moon?caption('月亮',p.sky.moon.azimuthDeg,p.sky.moon.altitudeDeg):'';
      if(sun||moon){
        const sunWidth=hud.measureText(sun).width,moonWidth=hud.measureText(moon).width;
        const gap=sun&&moon?12:0;
        hud.fillStyle='rgba(14,26,34,.78)';hud.fillRect(8,8,sunWidth+moonWidth+gap+16,27);
        hud.fillStyle='#ffcd70';hud.fillText(sun,16,26);hud.fillStyle='#d6e6ff';hud.fillText(moon,16+sunWidth+gap,26);
      }
      hud.fillStyle='rgba(14,26,34,.8)';hud.fillRect(0,p.height-66,p.width,66);
      hud.fillStyle='#f8faf4';hud.font='bold 15px sans-serif';
      hud.fillText(p.stamp,14,p.height-41);
      hud.textAlign='right';hud.font='13px sans-serif';hud.fillText((p.distance/1000).toFixed(2)+' / '+(p.total/1000).toFixed(2)+' km',p.width-14,p.height-41);
      hud.fillStyle='#54646a';hud.fillRect(14,p.height-31,p.width-28,3);hud.fillStyle='#f3c05e';hud.fillRect(14,p.height-31,(p.width-28)*p.progress,3);
      hud.fillStyle='#e3e9e8';hud.font='11px sans-serif';hud.fillText(credit,p.width-14,p.height-9);
      hud.textAlign='left';hud.fillText(p.name,14,p.height-9,p.width-135);
      hud.restore();
      if(recordable) {
        onPresent(p.progress);
        if(p.captureFrames && starsReady)onFrame(output!,p.progress);
      }
    }
    redraw.current=draw;
    draw();
    onCanvas(output);
    return ()=>{redraw.current=null;cancelAnimationFrame(raf);onCanvas(null);};
  },[base,stars,terrain,output,onCanvas,onFrame,onPresent]);
  useLayoutEffect(()=>{redraw.current?.();},[shot]);
  return <div className="journey-stage">
    <canvas className="journey-source" ref={setBase}/>
    <canvas className="journey-stars" hidden={!layers.constellations&&!layers.milkyWay} aria-label="行程星空图层" ref={setStars}/>
    <div className="journey-satellite-source"><SatelliteTerrainCanvas observer={observer} pose={fallback.pose} optics={optics} width={width} height={height}
      journeyRoute={route} liveJourneyFrame={!captureFrames} retryKey={retryKey} onBuffer={rememberBuffer} onCameraResolved={rememberCamera} onStatus={rememberStatus} onRender={terrainDrawn} canvasRef={setTerrain}/></div>
    <canvas className="journey-composite" ref={setOutput} aria-label="第三人称行程与录像画面"/>
    {error && <div className="journey-error" role="alert">{error}</div>}
  </div>;
}
