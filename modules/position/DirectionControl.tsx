import { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import type { DirectionMode } from './types';
const MODES: {id:DirectionMode;label:string}[]=[
  {id:'free',label:'自由转向'},{id:'north',label:'正北朝上'},
  {id:'device',label:'手机朝向朝上'},{id:'motion',label:'运动方向朝上'},
];
export function DirectionControl({mode,status,onChange}:{mode:DirectionMode;status?:string;onChange:(mode:DirectionMode)=>void}){
  const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setOpen(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[open]);
  return <>
    <button ref={button} className="position-dock-button position-direction-button glass" aria-label="地图朝向模式"
      aria-expanded={open} aria-pressed={mode==='device'||mode==='motion'} title={status||MODES.find(m=>m.id===mode)?.label} onClick={()=>setOpen(v=>!v)}>
      <Compass size={17}/><small>{mode==='motion'?'运动朝上':mode==='device'?'手机朝上':mode==='north'?'正北':'方向'}</small>
    </button>
    {open&&<div ref={root} className="direction-menu glass" role="group" aria-label="选择地图朝向">
      {MODES.map(m=><button key={m.id} aria-pressed={m.id===mode} onClick={()=>{onChange(m.id);setOpen(false);button.current?.focus();}}>{m.label}</button>)}
      <small>{mode==='motion'&&status?status:'运动方向根据定位航向计算；停下时保持方向。'}</small>
    </div>}
  </>;
}
