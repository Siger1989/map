import { useEffect, useRef, useState } from 'react';
import type { PositionFix } from './types';
import { MotionHeading } from './motionHeading';

export function useMotionHeading(fix: PositionFix | null, enabled: boolean) {
  const current=useRef(fix);current.current=fix;
  const [state,setState]=useState<{heading:number|null;status:string}>({heading:null,status:''});
  useEffect(()=>{
    if(!enabled){setState({heading:null,status:''});return;}
    const model=new MotionHeading(), bridge=window.GuanyunNative;
    let acceleration:{rms:number;time:number}|null=null;
    bridge?.motionEnabled?.(true);
    const motion=(event:DeviceMotionEvent)=>{
      const a=event.acceleration;
      if(a&&a.x!==null&&a.y!==null&&a.z!==null)acceleration={rms:Math.hypot(a.x,a.y,a.z),time:Date.now()};
    };
    if(!bridge?.motionState)window.addEventListener('devicemotion',motion);
    const update=()=>{
      if(document.hidden)return;
      if(bridge?.motionState)try{acceleration=JSON.parse(bridge.motionState());}catch{acceleration=null;}
      const now=Date.now();
      const quiet=!!acceleration&&now-acceleration.time<2000&&acceleration.rms<0.12;
      const next=model.update(current.current,now,quiet);
      setState(previous=>previous.heading===next.heading&&previous.status===next.status?previous:next);
    };
    update();const timer=setInterval(update,500);
    return()=>{clearInterval(timer);window.removeEventListener('devicemotion',motion);bridge?.motionEnabled?.(false);};
  },[enabled]);
  return state;
}
