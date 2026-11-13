import { Compass, Navigation2 } from 'lucide-react';
import type { DirectionMode } from './types';
const MODES: {id:DirectionMode;label:string}[]=[
  {id:'free',label:'自由转向'},{id:'north',label:'正北朝上'},
  {id:'device',label:'手机朝向朝上'},{id:'motion',label:'运动方向朝上'},
];
const SHORT_LABELS: Record<DirectionMode,string> = {
  free:'自由', north:'正北', device:'手机', motion:'运动',
};
export function DirectionControl({mode,status,onChange}:{mode:DirectionMode;status?:string;onChange:(mode:DirectionMode)=>void}){
  const currentIndex=Math.max(0,MODES.findIndex(item=>item.id===mode));
  const current=MODES[currentIndex];
  const next=MODES[(currentIndex+1)%MODES.length];
  const accessibleLabel=`当前${current.label}；点击切换到${next.label}`;
  return <button className="position-dock-button position-direction-button glass" aria-label={accessibleLabel}
      aria-pressed={mode!=='free'} title={[accessibleLabel,status].filter(Boolean).join('；')} onClick={()=>onChange(next.id)}>
      {mode==='motion'?<Navigation2 size={17} fill="currentColor"/>:<Compass size={17}/>}
      <small>{SHORT_LABELS[mode]}</small>
    </button>;
}
