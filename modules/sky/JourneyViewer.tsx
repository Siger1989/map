import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getObserverTimeZone } from './astronomy';
import { createJourneyPlayback, getJourneyPlaybackFrame, journeyCameraSettings, type SkyJourney } from './journeyPlayback';
import {
  JOURNEY_CAMERA_DISTANCE_MAX_M, JOURNEY_CAMERA_DISTANCE_MIN_M, JOURNEY_CAMERA_DISTANCE_STEP_M,
  JOURNEY_CAMERA_LAG_M, normalizeJourneyCameraDistance,
} from './journeyCamera';
import { journeyInstant, journeyNextDay, journeyTimeAt, localMinute } from './journeyClock';
import { JourneyStage, type ImageryStatus } from './JourneyStage';
import type { JourneyTerrainBuffer } from './satelliteTerrainRenderer';
import { JourneySkyLayers, useJourneySkyLayers } from './JourneySkyLayers';
import { startSkyJourneyRecording, saveSkyJourneyRecording } from './journeyRecorder';
import './journeyViewer.css';

type Phase='paused'|'preparing'|'playing'|'arming'|'recording'|'saving';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const recordingFps=24;
const cameraDistanceStorageKey='shantu:journey:camera-distance-m';

function savedCameraDistance(): number {
  try {
    const stored=window.localStorage.getItem(cameraDistanceStorageKey);
    if(stored!==null){
      const value=Number(stored);
      if(value===normalizeJourneyCameraDistance(value))return value;
    }
  } catch { /* Storage can be unavailable inside a restricted preview. */ }
  return JOURNEY_CAMERA_LAG_M;
}

export function JourneyViewer({journey,onClose}:{journey:SkyJourney;onClose():void}) {
  const model=useMemo(()=>createJourneyPlayback(journey),[journey]);
  const origin=useMemo(()=>getJourneyPlaybackFrame(model,0),[model]);
  const zone=useMemo(()=>origin?getObserverTimeZone(origin.coordinates[1],origin.coordinates[0]):'UTC',[origin]);
  const [departure,setDeparture]=useState(()=>origin?.timeMs!=null?localMinute(origin.timeMs,zone):localMinute(Date.now(),zone).slice(0,10)+'T07:00');
  const [arrival,setArrival]=useState(()=>{
    const end=getJourneyPlaybackFrame(model,model.totalDistanceM);
    if(origin?.timeMs!=null && end?.timeMs!=null && end.timeMs>origin.timeMs)return localMinute(end.timeMs,zone);
    return localMinute((journeyInstant(departure,zone)??Date.now())+4*3600000,zone);
  });
  const start=useMemo(()=>journeyInstant(departure,zone),[departure,zone]);
  const end=useMemo(()=>journeyInstant(arrival,zone),[arrival,zone]);
  const nextDay=useMemo(()=>journeyNextDay(departure,zone),[departure,zone]);
  const nextDaySelected=!!nextDay && arrival.slice(0,10)===nextDay.date;
  const midnight=useMemo(()=>{
    if(!nextDay || start===null || end===null || nextDay.startMs<=start || nextDay.startMs>end)return null;
    return {fraction:(nextDay.startMs-start)/(end-start),clock:localMinute(nextDay.startMs,zone).slice(11)};
  },[start,end,nextDay,zone]);
  const valid=start!==null && end!==null && end>start && model.totalDistanceM>0;
  const [seconds,setSeconds]=useState(30);
  const [cameraDistance,setCameraDistance]=useState(savedCameraDistance);
  const [appliedCameraDistance,setAppliedCameraDistance]=useState(cameraDistance);
  const [distanceOpen,setDistanceOpen]=useState(false);
  const pendingCameraDistance=useRef(cameraDistance);
  const appliedDistanceRef=useRef(cameraDistance);
  const cameraDistanceTimer=useRef<number|undefined>(undefined);
  const distanceControls=useRef<HTMLDivElement>(null);
  const distanceToggle=useRef<HTMLButtonElement>(null);
  const distancePanelId=useId();
  const applyCameraDistance=useCallback(()=>{
    window.clearTimeout(cameraDistanceTimer.current);
    const next=pendingCameraDistance.current;
    if(next===appliedDistanceRef.current)return;
    appliedDistanceRef.current=next;
    setAppliedCameraDistance(next);
    try { window.localStorage.setItem(cameraDistanceStorageKey,String(next)); }
    catch { /* The current journey can still use the chosen distance. */ }
  },[]);
  useEffect(()=>()=>window.clearTimeout(cameraDistanceTimer.current),[]);
  const changeCameraDistance=(distanceM:number)=>{
    const next=normalizeJourneyCameraDistance(distanceM);
    pendingCameraDistance.current=next;
    setCameraDistance(next);
    window.clearTimeout(cameraDistanceTimer.current);
    // Wait for a drag to settle before rebuilding the camera's terrain corridor.
    cameraDistanceTimer.current=window.setTimeout(applyCameraDistance,120);
  };
  const closeDistance=()=>{applyCameraDistance();setDistanceOpen(false);};
  const closeViewer=()=>{applyCameraDistance();onClose();};
  const [form,setForm]=useState(true);
  const [phase,setPhase]=useState<Phase>('paused');
  const [layers,setLayers]=useJourneySkyLayers();
  const [progress,setProgress]=useState(0);
  const [imagery,setImagery]=useState<ImageryStatus>('loading');
  const [buffer,setBuffer]=useState<JourneyTerrainBuffer | null>(null);
  const currentBuffer=useRef<JourneyTerrainBuffer | null>(null);
  const [retryKey,setRetryKey]=useState(0);
  const lastPresented=useRef<number | null>(null);
  const onPresent=useCallback((fraction:number)=>{lastPresented.current=fraction;},[]);
  const onBuffer=useCallback((next:JourneyTerrainBuffer)=>{
    const prior=currentBuffer.current;
    if(prior && prior.status===next.status && prior.loaded===next.loaded && prior.total===next.total &&
      prior.frameReady===next.frameReady && prior.frameDegraded===next.frameDegraded && prior.detailLoaded===next.detailLoaded &&
      prior.detailTotal===next.detailTotal && prior.minDetailZoom===next.minDetailZoom &&
      prior.throughDistanceM===next.throughDistanceM && prior.unavailableTiles===next.unavailableTiles)return;
    currentBuffer.current={...next};
    setBuffer(currentBuffer.current);
  },[]);
  const [message,setMessage]=useState('');
  const [movie,setMovie]=useState<Blob|null>(null);
  const [canvas,setCanvas]=useState<HTMLCanvasElement|null>(null);
  const recording=useRef<ReturnType<typeof startSkyJourneyRecording>|null>(null);
  const captureSurface=useRef<HTMLCanvasElement|null>(null);
  const presented = useRef<{canvas: HTMLCanvasElement; fraction: number} | null>(null);
  const timing=useRef({index:0,count:1});
  const encodingState=useRef({phase,imagery});
  encodingState.current={phase,imagery};
  const composeRecordingFrame=useCallback((frame:HTMLCanvasElement,fraction:number)=>{
    presented.current = {canvas: frame, fraction};
    const rec=recording.current;
    const state=encodingState.current;
    if(rec?.timedFrames && (state.phase!=='recording'||!['ready','partial'].includes(state.imagery)))return;
    const clock=timing.current;
    if(rec?.timedFrames && (clock.index>clock.count || Math.abs(fraction-clock.index/clock.count)>0.000001))return;
    const target=captureSurface.current;
    if(!target || !frame.width || !frame.height)return;
    target.getContext('2d',{alpha:false})?.drawImage(frame,0,0,target.width,target.height);
    if(!rec)return;
    if(!rec.timedFrames){
      rec.requestFrame();
      if(fraction >= 1 && state.phase === 'recording') setPhase('saving');
      return;
    }
    if(!rec.requestFrame(true,Math.round(clock.index*1e6/recordingFps)))return;
    if(clock.index===clock.count){clock.index++;setPhase('saving');return;}
    clock.index++;setProgress(clock.index/clock.count);
  },[]);
  const mounted=useRef(true);
  const lastProgress=useRef(progress);
  lastProgress.current=progress;
  const capture=phase==='arming' || phase==='recording' || phase==='saving';
  const distance=progress*model.totalDistanceM;
  const cameraSettings=useMemo(()=>journeyCameraSettings(model,seconds,appliedCameraDistance),[model,seconds,appliedCameraDistance]);
  const frame=useMemo(()=>getJourneyPlaybackFrame(model,distance,cameraSettings),[model,distance,cameraSettings]);
  const [stage,setStage]=useState<HTMLDivElement|null>(null);
  const [size,setSize]=useState({width:390,height:480});
  useEffect(()=>{
    if(!stage)return;
    const measure=()=>setSize({width:Math.max(1,stage.clientWidth),height:Math.max(1,stage.clientHeight)});
    measure();const ro=new ResizeObserver(measure);ro.observe(stage);return ()=>ro.disconnect();
  },[stage]);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;recording.current?.cancel();recording.current=null;};},[]);
  const abort=useCallback((msg:string)=>{
    recording.current?.cancel();recording.current=null;captureSurface.current=null;setMessage(msg);setPhase('paused');
  },[]);
  useEffect(()=>{
    const background=()=>{if(document.hidden && (phase==='recording'||phase==='arming'))abort('应用进入后台，录像已取消');else if(document.hidden && (phase==='playing'||phase==='preparing'))setPhase('paused');};
    document.addEventListener('visibilitychange',background);
    return ()=>document.removeEventListener('visibilitychange',background);
  },[phase,abort]);
  const textured=(imagery==='ready'||imagery==='partial') && !!buffer?.frameReady;
  const prepared=textured && (buffer?.status==='ready'||buffer?.status==='degraded');
  useEffect(()=>{
    if(phase==='preparing' && prepared)setPhase('playing');
  },[phase,prepared]);
  useEffect(()=>{
    if(phase!=='arming'||!canvas||!prepared)return;
    let request = 0;
    const startAtTrailhead = () => {
      if (presented.current?.canvas !== canvas || presented.current.fraction !== 0) {
        request = requestAnimationFrame(startAtTrailhead);
        return;
      }
      try{
        const target=document.createElement('canvas');
        const scale=Math.min(1,960/Math.max(1,canvas.width,canvas.height));
        target.width=Math.max(16,16*Math.round(canvas.width*scale/16));
        target.height=Math.max(16,16*Math.round(canvas.height*scale/16));
        captureSurface.current=target;
        timing.current={index:0,count:seconds*recordingFps};
        composeRecordingFrame(canvas,0);
        recording.current=startSkyJourneyRecording(target,{frameRate:recordingFps,maxDurationMs:seconds*12000+60000});
        composeRecordingFrame(canvas,0);
        setMessage('');setPhase('recording');
      }catch(e){abort(e instanceof Error?e.message:'此设备无法录制视频');}
    };
    request = requestAnimationFrame(startAtTrailhead);
    return ()=>cancelAnimationFrame(request);
  },[phase,canvas,prepared,seconds,abort,composeRecordingFrame]);
  useEffect(()=>{
    if(phase!=='recording' && phase!=='playing')return;
    if(!textured) {if(phase==='recording')recording.current?.pause();return;}
    if(phase==='recording')recording.current?.resume();
    if(phase==='recording' && recording.current?.timedFrames)return;
    let initial=lastProgress.current, previous=performance.now(), raf=0;
    const tick=(now:number)=>{
      if(lastPresented.current!==initial || !currentBuffer.current?.frameReady){
        // Waiting for map data is outside simulated time.
        previous=now;raf=requestAnimationFrame(tick);return;
      }
      const elapsed=Math.min(now-previous,phase==='playing' ? 1000/15 : 125);
      initial=clamp(initial+elapsed/(seconds*1000));previous=now;
      lastProgress.current=initial;setProgress(initial);
      if(initial<1){raf=requestAnimationFrame(tick);return;}
      if(phase==='playing'){setPhase('paused');return;}
      // The recorder finishes when the compositor presents the actual arrival frame.
    };
    raf=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(raf);
  },[phase,seconds,textured,abort]);
  useEffect(()=>{
    if(phase!=='saving'||!recording.current)return;
    // Let the compositor paint the arrival moment before asking for the final encoded chunk.
    const timer=window.setTimeout(async()=>{
      const rec=recording.current;if(!rec)return;
      try{const blob=await rec.stop();if(mounted.current && recording.current===rec){setMovie(blob);setMessage('录像已完成，可以保存');}}
      catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:'视频编码失败');}
      finally{if(mounted.current && recording.current===rec){recording.current=null;captureSurface.current=null;setPhase('paused');}}
    },150);
    return ()=>clearTimeout(timer);
  },[phase]);
  const missing=imagery==='unavailable'||imagery==='error'||buffer?.status==='unavailable';
  useEffect(()=>{
    if(missing && phase==='recording')abort('当前路段缺少地图，录制已停止。请重试加载后重新录制。');
  },[missing,phase,abort]);
  const select=(fraction:number)=>{if(capture)return;setPhase('paused');setProgress(clamp(fraction));};
  const changeDeparture=(value:string)=>{
    if(value && arrival && value.slice(0,10)!==departure.slice(0,10)){
      const newDate=nextDaySelected ? journeyNextDay(value,zone)?.date :
        arrival.slice(0,10)===departure.slice(0,10) ? value.slice(0,10) : null;
      if(newDate)setArrival(newDate+arrival.slice(10));
    }
    setDeparture(value);select(0);
  };
  const toggleArrivalDay=()=>{
    if(!nextDay)return;
    const date=nextDaySelected ? departure.slice(0,10) : nextDay.date;
    setArrival(date+'T'+(arrival.slice(11)||departure.slice(11)));
    select(0);
  };
  const launch=(record:boolean)=>{
    if(!valid){setForm(true);setMessage('请填写有效的出发和到达日期时间，到达须晚于出发');return;}
    closeDistance();
    if(record||progress>=1){presented.current=null;lastProgress.current=0;setProgress(0);}
    setForm(false);setMessage('');setPhase(record?'arming':'preparing');
  };
  const save=async()=>{
    if(!movie)return;
    try{await saveSkyJourneyRecording(movie);setMessage('已发起保存录像');}
    catch(e){setMessage(e instanceof Error?e.message:'保存失败，可以重试');}
  };
  const at=start===null ? Date.now() : journeyTimeAt(start,end??start,progress);
  const starting=phase==='preparing'||phase==='arming';
  const buffering=!missing && (!textured || (!prepared && (phase==='paused'||starting)));
  const count=buffer?.total ? ` ${buffer.loaded}/${buffer.total}` : '';
  const degraded=buffer?.frameReady && buffer.frameDegraded;
  const missingAhead=!!buffer?.unavailableTiles && buffer.status==='degraded';
  const fallbackText=buffer && buffer.detailLoaded<buffer.detailTotal
    ? '此段高清影像暂缺，显示较低分辨率影像' : '此段部分地图数据使用较低精度';
  const status=missing?'当前路段地图未能加载':buffering?'正在预载沿途地图'+count:
    degraded?fallbackText:missingAhead?`沿途有 ${buffer.unavailableTiles} 块地图暂缺`:'';
  const retry=()=>{currentBuffer.current=null;setBuffer(null);setMessage('');setRetryKey(key=>key+1);};
  return <section className="journey-viewer" role="dialog" aria-modal="true" aria-label="第三人称行程模拟" onPointerDown={e=>{
    if(distanceOpen && !distanceControls.current?.contains(e.target as Node))closeDistance();
  }} onKeyDown={e=>{
    if(e.key!=='Escape')return;
    e.preventDefault();e.stopPropagation();
    if(distanceOpen){closeDistance();distanceToggle.current?.focus();}
    else closeViewer();
  }}>
    <header><div><strong>第三人称行程模拟</strong><small>{journey.name}</small></div>
      <div className="journey-header-actions"><JourneySkyLayers layers={layers} onChange={setLayers} disabled={capture}/>
        <button autoFocus type="button" onClick={closeViewer}>退出</button></div></header>
    <div className="journey-window" ref={setStage} data-buffer-state={buffer?.status??'loading'} data-frame-ready={textured}
      data-detail-zoom={buffer?.minDetailZoom} data-detail-loaded={buffer?.detailLoaded} data-detail-total={buffer?.detailTotal}
      data-frame-degraded={buffer?.frameDegraded} data-camera-motion={frame?.cameraMotion ? 'gimbal' : undefined}
      data-camera-distance={appliedCameraDistance} data-distance-open={distanceOpen && !capture}>
      {frame && <JourneyStage model={model} frame={frame} time={at} zone={zone} name={journey.name} progress={progress}
        {...size} layers={layers} retryKey={retryKey} onBuffer={onBuffer} onPresent={onPresent} captureFrames={phase==='arming'||phase==='recording'||phase==='saving'}
        onCanvas={setCanvas} onFrame={composeRecordingFrame} onImagery={setImagery}/>}
      {status && <span className="journey-imagery" role="status">{status}{(missing||degraded||missingAhead) && <button type="button" onClick={retry}>重试加载</button>}</span>}
      <div className="journey-distance" ref={distanceControls}>
        <button type="button" className="journey-distance-toggle" ref={distanceToggle} disabled={capture||!frame}
          aria-label={`镜头距离 ${cameraDistance} 米`} aria-expanded={distanceOpen} aria-controls={distancePanelId}
          onClick={()=>distanceOpen?closeDistance():setDistanceOpen(true)}>距离 {cameraDistance} m</button>
        <div className="journey-distance-panel" id={distancePanelId} hidden={!distanceOpen||capture}>
          <input type="range" aria-label="镜头距离" aria-valuetext={`${cameraDistance} 米`} value={cameraDistance}
            min={JOURNEY_CAMERA_DISTANCE_MIN_M} max={JOURNEY_CAMERA_DISTANCE_MAX_M} step={JOURNEY_CAMERA_DISTANCE_STEP_M}
            disabled={capture} onChange={e=>changeCameraDistance(e.target.valueAsNumber)} onPointerUp={applyCameraDistance}
            onPointerCancel={applyCameraDistance} onBlur={applyCameraDistance}/>
          <div className="journey-distance-scale" aria-hidden="true"><span>近</span><span>远</span></div>
        </div>
      </div>
    </div>
    <section className="journey-controls" aria-label="行程时间轴">
      {form && <div className="journey-dates">
        <label>出发<input type="datetime-local" aria-label="出发时间" value={departure} onChange={e=>changeDeparture(e.target.value)}/></label>
        <label>到达<input type="datetime-local" aria-label="到达时间" value={arrival} onChange={e=>{setArrival(e.target.value);select(0);}}/></label>
        <div className="journey-date-options"><small>出发地时区 {zone}</small>
          <button type="button" disabled={!nextDay || capture} aria-pressed={nextDaySelected} onClick={toggleArrivalDay}>次日到达</button>
        </div>
      </div>}
      <div className="journey-timeline">
      <input aria-label="行程进度" type="range" min={0} max={10000} value={Math.round(progress*10000)} disabled={capture} onChange={e=>select(Number(e.target.value)/10000)}/>
      {midnight && <div className="journey-day-boundary">
        <i aria-hidden="true" style={{left:`${midnight.fraction*100}%`}}/>
        <button type="button" disabled={capture} style={{left:`clamp(36px, ${midnight.fraction*100}%, calc(100% - 36px))`}}
          aria-label={`跳至次日 ${midnight.clock}`} onClick={()=>select(midnight.fraction)}>次日 {midnight.clock}</button>
      </div>}
      </div>
      <div className="journey-actions">
        <button disabled={capture} onClick={()=>{setPhase('paused');setForm(v=>!v);}}>设时间</button>
        <select aria-label="回放时长" disabled={capture} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}>
          {[15,30,60,90].map(n=><option key={n} value={n}>{n} 秒回放</option>)}
        </select>
        <button disabled={capture||!origin} onClick={()=>phase==='playing'||phase==='preparing'?setPhase('paused'):launch(false)}>{phase==='preparing'?'取消等待':phase==='playing'?'暂停':progress>=1?'重播':'播放'}</button>
        <button disabled={phase==='saving'||!origin} onClick={()=>capture?abort('录像已取消'):launch(true)}>{capture?'取消录像':'录制整段'}</button>
        {movie && <button disabled={capture} onClick={()=>void save()}>保存录像</button>}
      </div>
      {(message||capture||!valid) && <small role="status">{message || (phase==='arming'?'正在准备起点画面…':phase==='recording'?'正在录制整段行程':phase==='saving'?'正在生成视频…':!origin?'轨迹没有可播放的线段':'到达时间须晚于出发时间')}</small>}
    </section>
  </section>;
}
