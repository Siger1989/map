import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getObserverTimeZone } from './astronomy';
import { createJourneyPlayback, getJourneyPlaybackFrame, type SkyJourney } from './journeyPlayback';
import { journeyInstant, localMinute } from './journeyClock';
import { JourneyStage, type ImageryStatus } from './JourneyStage';
import { startSkyJourneyRecording, saveSkyJourneyRecording } from './journeyRecorder';
import './journeyViewer.css';

type Phase='paused'|'playing'|'arming'|'recording'|'saving';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));

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
  const valid=start!==null && end!==null && end>start && model.totalDistanceM>0;
  const [seconds,setSeconds]=useState(30);
  const [form,setForm]=useState(true);
  const [phase,setPhase]=useState<Phase>('paused');
  const [progress,setProgress]=useState(0);
  const [imagery,setImagery]=useState<ImageryStatus>('loading');
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
    if(!rec.requestFrame(true,Math.round(clock.index*1e6/12)))return;
    if(clock.index===clock.count){clock.index++;setPhase('saving');return;}
    clock.index++;setProgress(clock.index/clock.count);
  },[]);
  const mounted=useRef(true);
  const lastProgress=useRef(progress);
  lastProgress.current=progress;
  const capture=phase==='arming' || phase==='recording' || phase==='saving';
  const distance=progress*model.totalDistanceM;
  const frame=useMemo(()=>getJourneyPlaybackFrame(model,distance),[model,distance]);
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
    const background=()=>{if(document.hidden && (phase==='recording'||phase==='arming'))abort('应用进入后台，录像已取消');else if(document.hidden && phase==='playing')setPhase('paused');};
    document.addEventListener('visibilitychange',background);
    return ()=>document.removeEventListener('visibilitychange',background);
  },[phase,abort]);
  const textured=imagery==='ready'||imagery==='partial';
  useEffect(()=>{
    if(phase!=='arming'||!canvas||!textured)return;
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
        timing.current={index:0,count:seconds*12};
        composeRecordingFrame(canvas,0);
        recording.current=startSkyJourneyRecording(target,{frameRate:12,maxDurationMs:seconds*12000+60000});
        composeRecordingFrame(canvas,0);
        setMessage('');setPhase('recording');
      }catch(e){abort(e instanceof Error?e.message:'此设备无法录制视频');}
    };
    request = requestAnimationFrame(startAtTrailhead);
    return ()=>cancelAnimationFrame(request);
  },[phase,canvas,textured,seconds,abort,composeRecordingFrame]);
  useEffect(()=>{
    if(phase!=='recording' && phase!=='playing')return;
    if(phase==='recording' && !textured) {
      recording.current?.pause();
      const timeout=window.setTimeout(()=>abort('沿途卫星影像未能读取，录像已取消，可在影像加载后重试'),18000);
      return ()=>clearTimeout(timeout);
    }
    if(phase==='recording')recording.current?.resume();
    if(phase==='recording' && recording.current?.timedFrames)return;
    let initial=lastProgress.current, previous=performance.now(), raf=0;
    const tick=(now:number)=>{
      if(now-previous<40){raf=requestAnimationFrame(tick);return;}
      initial=clamp(initial+(now-previous)/(seconds*1000));previous=now;
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
  useEffect(()=>{
    if(phase!=='arming')return;
    const timeout=window.setTimeout(()=>abort('尚未收到可录制的天地图卫星影像，请加载后重试'),20000);
    return ()=>clearTimeout(timeout);
  },[phase,abort]);
  const select=(fraction:number)=>{if(capture)return;setPhase('paused');setProgress(clamp(fraction));};
  const launch=(record:boolean)=>{
    if(!valid){setForm(true);setMessage('请填写有效的出发和到达日期时间，到达须晚于出发');return;}
    if(record||progress>=1){presented.current=null;lastProgress.current=0;setProgress(0);}
    setForm(false);setMessage('');setPhase(record?'arming':'playing');
  };
  const save=async()=>{
    if(!movie)return;
    try{await saveSkyJourneyRecording(movie);setMessage('已发起保存录像');}
    catch(e){setMessage(e instanceof Error?e.message:'保存失败，可以重试');}
  };
  const at=(start??Date.now())+Math.max(0,(end??0)-(start??0))*progress;
  const status=imagery==='unavailable'||imagery==='error'?'天地图卫星影像暂不可用':imagery==='loading'?'正在加载天地图卫星影像':imagery==='partial'?'部分卫星影像已加载':'';
  return <section className="journey-viewer" role="dialog" aria-modal="true" aria-label="第三人称行程模拟" onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}
  }}>
    <header><div><strong>第三人称行程模拟</strong><small>{journey.name}</small></div><button autoFocus type="button" onClick={onClose}>退出</button></header>
    <div className="journey-window" ref={setStage}>
      {frame && <JourneyStage model={model} frame={frame} time={at} zone={zone} name={journey.name} progress={progress}
        {...size} onCanvas={setCanvas} onFrame={composeRecordingFrame} onImagery={setImagery}/>}
      {status && <span className="journey-imagery">{status}</span>}
    </div>
    <section className="journey-controls" aria-label="行程时间轴">
      {form && <div className="journey-dates">
        <label>出发<input type="datetime-local" aria-label="出发时间" value={departure} onChange={e=>{setDeparture(e.target.value);select(0);}}/></label>
        <label>到达<input type="datetime-local" aria-label="到达时间" value={arrival} onChange={e=>{setArrival(e.target.value);select(0);}}/></label>
        <small>出发地时区 {zone}</small>
      </div>}
      <input aria-label="行程进度" type="range" min={0} max={10000} value={Math.round(progress*10000)} disabled={capture} onChange={e=>select(Number(e.target.value)/10000)}/>
      <div className="journey-actions">
        <button disabled={capture} onClick={()=>{setPhase('paused');setForm(v=>!v);}}>设时间</button>
        <select aria-label="回放时长" disabled={capture} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}>
          {[15,30,60,90].map(n=><option key={n} value={n}>{n} 秒回放</option>)}
        </select>
        <button disabled={capture||!origin} onClick={()=>phase==='playing'?setPhase('paused'):launch(false)}>{phase==='playing'?'暂停':progress>=1?'重播':'播放'}</button>
        <button disabled={phase==='saving'||!origin} onClick={()=>capture?abort('录像已取消'):launch(true)}>{capture?'取消录像':'录制整段'}</button>
        {movie && <button disabled={capture} onClick={()=>void save()}>保存录像</button>}
      </div>
      {(message||capture||!valid) && <small role="status">{message || (phase==='arming'?'正在准备起点画面…':phase==='recording'?'正在录制整段行程':phase==='saving'?'正在生成视频…':!origin?'轨迹没有可播放的线段':'到达时间须晚于出发时间')}</small>}
    </section>
  </section>;
}
